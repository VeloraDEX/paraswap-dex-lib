import dotenv from 'dotenv';
dotenv.config();

import { AirSwapRegistry } from './registry';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { AirSwapRegistryState } from './types';
import { AirSwapConfig } from './config';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  registry: AirSwapRegistry,
  blockNumber: number,
  poolAddress: string,
): Promise<AirSwapRegistryState> {
  return {
    stakerServerURLs: {},
    protocolsByStaker: {},
    stakersByProtocol: {},
    tokensByStaker: {},
    stakersByToken: {},
  };
}

type EventMappings = Record<string, number[]>;

describe('AirSwap EventPool Mainnet', function () {
  const dexKey = 'AirSwap';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let registry: AirSwapRegistry;

  const eventsToTest: Record<Address, EventMappings> = {
    [AirSwapConfig.AirSwap[network].registryAddress]: {
      SetServerURL: [0],
      AddProtocols: [0],
      RemoveProtocols: [0],
      UnsetServer: [0],
    },
  };

  beforeEach(async () => {
    registry = new AirSwapRegistry(dexKey, network, dexHelper, logger);
  });

  Object.entries(eventsToTest).forEach(
    ([registryAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${registryAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    registry,
                    registry.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(registry, _blockNumber, registryAddress),
                    blockNumber,
                    `${dexKey}_${registryAddress}`,
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
