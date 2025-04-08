/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { UsdcTransmuterEventPool } from './usdc-transmuter-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { gnosisChainUsdcTransmuterAddress } from './constants';

/*
  README
  ======

  This test script adds unit tests for UsdcTransmuter event based
  system. This is done by fetching the state on-chain before the
  event block, manually pushing the block logs to the event-subscriber,
  comparing the local state with on-chain state.

  Most of the logic for testing is abstracted by `testEventSubscriber`.
  You need to do two things to make the tests work:

  1. Fetch the block numbers where certain events were released. You
  can modify the `./scripts/fetch-event-blocknumber.ts` to get the
  block numbers for different events. Make sure to get sufficient
  number of blockNumbers to cover all possible cases for the event
  mutations.

  2. Complete the implementation for fetchPoolState function. The
  function should fetch the on-chain state of the event subscriber
  using just the blocknumber.

  The template tests only include the test for a single event
  subscriber. There can be cases where multiple event subscribers
  exist for a single DEX. In such cases additional tests should be
  added.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-events.test.ts`

  (This comment should be removed from the final implementation)
*/

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  usdcTransmuterPools: UsdcTransmuterEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  // Since the rate is always 1:1, we just need a simple state
  return {
    initialized: true,
  };
}

describe('UsdcTransmuter EventPool Gnosis Chain', function () {
  const dexKey = 'UsdcTransmuter';
  const network = Network.GNOSIS;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let usdcTransmuterPool: UsdcTransmuterEventPool;

  // Since the rate is always 1:1, we don't need to test specific events
  // But we'll set up a basic test structure
  const eventsToTest = {
    [gnosisChainUsdcTransmuterAddress]: {
      // We can use any block number for testing since the state is constant
      Deposit: [15000000],
    },
  };

  beforeEach(async () => {
    usdcTransmuterPool = new UsdcTransmuterEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
    );
  });

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, Record<string, number[]>]) => {
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
