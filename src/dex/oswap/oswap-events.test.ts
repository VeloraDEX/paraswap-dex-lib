/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { OSwapConfig } from './config';
import { OSwapEventPool } from './oswap-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { OSwapPool, OSwapPoolState } from './types';

jest.setTimeout(50 * 1000);

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

// Helper function. Returns the absolute value of the difference between 2 bigints.
function absdelta(a: bigint, b: bigint) {
  const delta = a - b;
  return delta < 0 ? -delta : delta;
}

function stateCompare(state1: OSwapPoolState, state2: OSwapPoolState) {
  const ROUNDING_ERROR = 2;

  expect(state1.traderate0).toEqual(state2.traderate0);
  expect(state1.traderate1).toEqual(state2.traderate1);
  // Some ERC20 tokens have rounding error which can lead to the balance computed from Transfer event valuee
  // to deviate by a couple gwei vs the on-chain balance.
  // For example stETH: https://docs.lido.fi/guides/lido-tokens-integration-guide/#1-2-wei-corner-case
  expect(
    absdelta(BigInt(state1.balance0), BigInt(state2.balance0)),
  ).toBeLessThanOrEqual(ROUNDING_ERROR);
  expect(
    absdelta(BigInt(state1.balance1), BigInt(state2.balance1)),
  ).toBeLessThanOrEqual(ROUNDING_ERROR);
}

describe('Oswap EventPool Mainnet', function () {
  const dexKey = 'OSwap';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  const pool: OSwapPool = OSwapConfig[dexKey][network].pools[0];

  let eventPool: OSwapEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    [pool.address]: {
      TraderateChanged: [22395781, 22395431, 22389403, 22389364, 22389179],
      Transfer: [22415989, 22409802],
      RedeemRequested: [22317636, 22280283, 22277504, 22255426, 22250671],
      RedeemClaimed: [22317698, 22302249, 22255494, 22250723, 22217971],
    },
  };

  beforeEach(async () => {
    eventPool = new OSwapEventPool(dexKey, pool, network, dexHelper, logger);
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
                    eventPool,
                    eventPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      eventPool.generateState(_blockNumber),
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                    (state1: OSwapPoolState, state2: OSwapPoolState) =>
                      stateCompare(state1, state2),
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
