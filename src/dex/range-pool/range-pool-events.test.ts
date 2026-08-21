/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { RangePoolEventPool } from './range-pool-pool';
import { RangePoolConfig } from './config';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';

/*
  Stage 4 events test.

  For each block, `testEventSubscriber`:
    1. fetches authoritative on-chain state at block-1 (generateState multicall),
    2. replays that block's logs through the subscriber,
    3. compares the resulting cached state to authoritative state at block.

  The replay therefore validates each single delta against chain, starting from an
  exact snapshot — no long-run drift. Blocks below are real ROME/USDT activity taken
  from the ranges-stats API (/pools/:address/{swaps,liquidity}); both swap directions
  and proportional liquidity adds (which also emit VirtualBalancesUpdated) are covered.

  Requires an ARCHIVE RPC: export HTTP_PROVIDER_1=<alchemy url>; run with --forceExit.
*/

jest.setTimeout(120 * 1000);

const dexKey = 'RangePool';
const network = Network.MAINNET;
const params = RangePoolConfig[dexKey][network];

async function fetchPoolState(
  rangePoolPool: RangePoolEventPool,
  blockNumber: number,
): Promise<PoolState> {
  return rangePoolPool.generateState(blockNumber) as Promise<PoolState>;
}

// Fact balances, totalSupply, flags and all immutables must match chain EXACTLY.
// Virtual balances match exactly for EXACT_IN swaps and all liquidity/resync events;
// they may differ by < one scaling factor (< 1 raw unit) ONLY for single-token-router
// corrective swaps (EXACT_OUT), whose kind the Vault Swap event cannot encode — that
// residual is overwritten authoritatively at the next VirtualBalancesUpdated. See the
// reconstruction note in range-pool-pool.ts and PROGRESS gotcha #7.
function compareState(state: PoolState, expected: PoolState): void {
  const { virtualBalances: vGot, ...restGot } = state;
  const { virtualBalances: vExp, ...restExp } = expected;
  expect(restGot).toEqual(restExp);
  expect(vGot.length).toEqual(vExp.length);
  vGot.forEach((v, i) => {
    const diff = v > vExp[i] ? v - vExp[i] : vExp[i] - v;
    expect(diff < state.scalingFactors[i]).toBe(true);
  });
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('RangePool EventPool Mainnet', function () {
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let rangePoolPool: RangePoolEventPool;

  // poolAddress -> EventMappings (labels are descriptive only; the harness replays
  // every log in the block regardless of label).
  const eventsToTest: Record<Address, EventMappings> = {
    // ROME/USDT 2-token pool
    ['0xaf037e69f0fa8d1633443cc0c67d0b73e3694b36']: {
      Swap: [
        25389158, // ROME -> USDT
        25252449, // ROME -> USDT
        25233083, // ROME -> USDT
        25364042, // USDT -> ROME
        25357733, // USDT -> ROME
        25291757, // USDT -> ROME
      ],
      Liquidity: [
        24927828, // add (also emits VirtualBalancesUpdated)
        24830800, // add
        24736471, // add
      ],
    },
  };

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  rangePoolPool = new RangePoolEventPool(
                    dexKey,
                    network,
                    dexHelper,
                    logger,
                    poolAddress,
                    params.vaultAddress,
                    params.hookAddress,
                  );

                  await testEventSubscriber(
                    rangePoolPool,
                    rangePoolPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(rangePoolPool, _blockNumber),
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                    compareState,
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
