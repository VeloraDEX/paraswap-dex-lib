import dotenv from 'dotenv';
dotenv.config();

import { CurveV2EventPool } from './curve-v2';
import { CurveV2Config } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';

/*
  README
  ======

  This test script adds unit tests for CurveV2 event based
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
const dexKey = 'CurveV2';
const network = Network.MAINNET;
const config = CurveV2Config[dexKey][network];

async function fetchPoolState(
  curveV2Pools: CurveV2EventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  // TODO: complete me!
}

describe('CurveV2 Event', function () {
  const blockNumbers: { [eventName: string]: number[] } = {
    // TODO: complete me!
  };

  describe('CurveV2EventPool', function () {
    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const curveV2Pools = new CurveV2EventPool(
            dexKey,
            network,
            dexHelper,
            logger,
          );

          await testEventSubscriber(
            curveV2Pools,
            curveV2Pools.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolState(curveV2Pools, _blockNumber, poolAddress),
            blockNumber,
            `${dexKey}_${poolAddress}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});
