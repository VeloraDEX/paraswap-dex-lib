/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { AaveGsmEventPool } from './aave-gsm-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { AaveGsmConfig } from './config';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  aaveGsmPool: AaveGsmEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  return aaveGsmPool.generateState(blockNumber);
}

// The stata rate accrues every block but only moves in the event state on
// ReserveDataUpdated, so it can trail the on-chain rate by a few blocks.
// ReserveDataUpdated blocks are compared exactly.
function compareState(state: PoolState, expected: PoolState) {
  const { rate, ...rest } = state;
  const { rate: expectedRate, ...expectedRest } = expected;
  expect(rest).toEqual(expectedRest);
  const diff = rate > expectedRate ? rate - expectedRate : expectedRate - rate;
  expect(diff * 1_000_000n).toBeLessThanOrEqual(expectedRate);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('AaveGsm EventPool Mainnet', function () {
  const dexKey = 'AaveGsm';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  const config = AaveGsmConfig[dexKey][network];
  let aaveGsmPool: AaveGsmEventPool;

  const underlyings: Record<Address, Address> = {
    [config.GSM_USDT]: config.waEthUSDT,
    [config.GSM_USDC]: config.waEthUSDC,
  };

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    [config.GSM_USDT]: {
      FeeStrategyUpdated: [25998106],
      BuyAsset: [26235835],
      SellAsset: [26234805],
      ExposureCapUpdated: [25285820],
      ReserveDataUpdated: [26234996],
    },
    [config.GSM_USDC]: {
      FeeStrategyUpdated: [25155555],
      BuyAsset: [25941286],
      SellAsset: [25923845],
      ExposureCapUpdated: [24665765],
      ReserveDataUpdated: [26234988],
    },
  };

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        beforeEach(async () => {
          aaveGsmPool = new AaveGsmEventPool(
            poolAddress,
            underlyings[poolAddress],
            config.POOL,
            dexKey,
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
                  await testEventSubscriber<PoolState>(
                    aaveGsmPool,
                    aaveGsmPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(aaveGsmPool, _blockNumber, poolAddress),
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                    eventName === 'ReserveDataUpdated'
                      ? undefined
                      : compareState,
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
