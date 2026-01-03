/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StabullEventPool } from './stabull-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';

/*
  README
  ======

  This test script adds unit tests for Stabull event based
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
  stabullPools: StabullEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const stateFetched = stabullPools.generateState(blockNumber);
  console.log('stateFetched', stateFetched);
  return stateFetched;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Stabull EventPool Mainnet', function () {
  const dexKey = 'Stabull';
  const network = Network.POLYGON;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let stabullPool: StabullEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    '0xFbBE4b730e1e77d02dC40fEdF9438E2802eab3B5': {
      Transfer: [69736648],
    },
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359': {
      Transfer: [69736648],
    },
  };

  beforeEach(async () => {
    stabullPool = new StabullEventPool(
      dexKey,
      network,
      dexHelper,
      '0xdcb7efACa996fe2985138bF31b647EFcd1D0901a', // hymanshu change
      [
        '0xFbBE4b730e1e77d02dC40fEdF9438E2802eab3B5',
        '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      ],
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
                    stabullPool,
                    stabullPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(stabullPool, _blockNumber, poolAddress),
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
