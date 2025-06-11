/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { UsdcTransmuterEventPool } from './usdc-transmuter-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { UsdcTransmuterConfig } from './config';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  usdcTransmuterPools: UsdcTransmuterEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const onChainState = await usdcTransmuterPools.generateState(blockNumber);
  return onChainState;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('UsdcTransmuter EventPool Gnosis Chain', function () {
  const dexKey = 'UsdcTransmuter';
  const network = Network.GNOSIS;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let usdcTransmuterPool: UsdcTransmuterEventPool;

  const eventsToTest: Record<Address, EventMappings> = {
    [UsdcTransmuterConfig[dexKey][network].usdcTransmuterAddress]: {
      Deposit: [40529616, 40529524, 40529345, 40529314, 40529296],
      Withdraw: [40529605, 40529583, 40529575, 40529504, 40529487],
    },
  };

  beforeEach(async () => {
    usdcTransmuterPool = new UsdcTransmuterEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      UsdcTransmuterConfig[dexKey][network].usdcTransmuterAddress,
      UsdcTransmuterConfig[dexKey][network].usdcToken.address,
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
                    usdcTransmuterPool,
                    usdcTransmuterPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(
                        usdcTransmuterPool,
                        _blockNumber,
                        poolAddress,
                      ),
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
