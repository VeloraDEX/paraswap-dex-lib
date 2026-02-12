/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { ClearFactory } from './clear-factory';
import { ClearConfig } from './config';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { ClearVault } from './types';
import { DeepReadonly } from 'ts-essentials';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  clearFactory: ClearFactory,
  blockNumber: number,
): Promise<DeepReadonly<ClearVault[]>> {
  return clearFactory.generateState(blockNumber);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Clear EventPool Mainnet', function () {
  const dexKey = 'Clear';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  const config = ClearConfig[dexKey][network];

  describe('Factory Events', () => {
    let clearFactory: ClearFactory;

    // Factory address -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [config.factoryAddress]: {
        NewClearVault: [23969538],
      },
    };

    Object.entries(eventsToTest).forEach(
      ([poolAddress, events]: [string, EventMappings]) => {
        describe(`Events for ${poolAddress}`, () => {
          beforeEach(() => {
            clearFactory = new ClearFactory(
              dexKey,
              config,
              network,
              dexHelper,
              logger,
            );
          });

          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      clearFactory,
                      clearFactory.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(clearFactory, _blockNumber),
                      blockNumber,
                      `${dexKey}_${poolAddress}`,
                      dexHelper.provider,
                    );
                  });
                });
              });
            },
          );
        });
      },
    );
  });
});
