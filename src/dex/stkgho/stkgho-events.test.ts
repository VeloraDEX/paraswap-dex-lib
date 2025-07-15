/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StkGHOEventPool } from './stkgho-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { StkGHOConfig } from './config';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  stkGHOPool: StkGHOEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const eventState = stkGHOPool.getState(blockNumber);
  if (eventState) return eventState;
  const onChainState = await stkGHOPool.generateState(blockNumber);
  stkGHOPool.setState(onChainState, blockNumber);
  return onChainState;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('StkGHO EventPool Mainnet', function () {
  const dexKey = 'StkGHO';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let stkGHOPool: StkGHOEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    [StkGHOConfig[dexKey][network].stkGHO]: {
      ExchangeRateChanged: [], // haven't been emitted yet
    },
  };

  beforeEach(async () => {
    stkGHOPool = new StkGHOEventPool(
      dexKey,
      dexKey,
      network,
      dexHelper,
      logger,
    );
  });

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    stkGHOPool,
                    stkGHOPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(stkGHOPool, _blockNumber, poolAddress),
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
