/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { FluidDexLiteEventPool } from './fluid-dex-lite-pool';
import { FluidDexLite } from './fluid-dex-lite';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolParams, PoolState } from './types';
import { calculateMappingStorageSlot, readFromStorageCall } from './utils';
import { Interface } from '@ethersproject/abi';
import {
  BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP,
  X33,
} from './fluid-dex-lite-math';

// Storage slot constants from DexLiteSlotsLink
const DEX_LITE_DEXES_LIST_SLOT = 1;
const DEX_LITE_DEX_VARIABLES_SLOT = 2;
const DEX_LITE_CENTER_PRICE_SHIFT_SLOT = 3;
const DEX_LITE_RANGE_SHIFT_SLOT = 4;
const DEX_LITE_THRESHOLD_SHIFT_SLOT = 5;

async function fetchPoolState(
  fluidDexLitePools: FluidDexLiteEventPool,
  dexHelper: DummyDexHelper,
  fluidDexLiteIface: Interface,
  fluidDexLiteAddress: Address,
  blockNumber: number,
): Promise<PoolState> {
  const dexIdBytes = fluidDexLitePools.poolParams.dexId;

  const slots = [
    DEX_LITE_DEX_VARIABLES_SLOT,
    DEX_LITE_CENTER_PRICE_SHIFT_SLOT,
    DEX_LITE_RANGE_SHIFT_SLOT,
    DEX_LITE_THRESHOLD_SHIFT_SLOT,
  ].map(slot => calculateMappingStorageSlot(slot, dexIdBytes));

  const calls = slots.map(slot =>
    readFromStorageCall(fluidDexLiteAddress, fluidDexLiteIface, slot),
  );

  const [
    { returnData: dexVariables },
    { returnData: centerPriceShift },
    { returnData: rangeShift },
    { returnData: thresholdShift },
  ] = await dexHelper.multiWrapper.tryAggregate<bigint>(
    false,
    calls,
    blockNumber,
  );

  const lastInteractionTimestamp =
    (centerPriceShift >>
      BigInt(BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP)) &
    X33;

  return {
    dexVariables,
    centerPriceShift,
    rangeShift,
    thresholdShift,
    lastInteractionTimestamp,
  };
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('FluidDexLite EventPool Mainnet', function () {
  const dexKey = 'FluidDexLite';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  const fluidDex = new FluidDexLite(network, dexKey, dexHelper);
  let fluidDexLitePool: FluidDexLiteEventPool;

  // USDC/USDT Pool
  const pool: PoolParams = {
    dexId: '0x6dd161107ef07bb8',
    dexKey: {
      token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      token1: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
  };

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    [fluidDex.dexLiteAddress]: {
      LogSwap: [23066399, 23066345, 23066339, 23066325, 23066293],
      LogDeposit: [23043195, 23055117, 23056328],
      LogInitialize: [23043115],
    },
  };

  beforeEach(async () => {
    fluidDexLitePool = new FluidDexLiteEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      '',
      fluidDex.fluidDexLiteIface,
      pool,
      fluidDex.dexLiteAddress,
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
                    fluidDexLitePool,
                    fluidDexLitePool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(
                        fluidDexLitePool,
                        dexHelper,
                        fluidDex.fluidDexLiteIface,
                        fluidDex.dexLiteAddress,
                        _blockNumber,
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
