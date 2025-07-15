/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { ApexDefiEventPool } from './apex-defi-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { Tokens } from '../../../tests/constants-e2e';

/*
  README
  ======

  This test script adds unit tests for ApexDefi event based
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
  apexDefiPools: ApexDefiEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `ApexDefi: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);

  const state = await apexDefiPools.generateState(blockNumber);

  console.log(`Done ${message}`);
  return state;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('ApexDefi EventPool Mainnet', function () {
  const dexKey = 'ApexDefi';
  const network = Network.AVALANCHE;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let apexDefiPool: ApexDefiEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    [Tokens[network].APEX.address]: {
      Swap: [65243326, 65243466, 65247603],
    },
  };

  beforeEach(async () => {
    apexDefiPool = new ApexDefiEventPool(
      dexKey,
      network,
      dexHelper,
      Tokens[network].AVAX.address, // token0
      Tokens[network].APEX.address, // token1
      Tokens[network].APEX.address, // poolAddress
      logger,
      '0x754A0c42C35562eE7a41eb824d14bc1259820f01', // apexDefiFactoryAddress
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
                    apexDefiPool,
                    apexDefiPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(apexDefiPool, _blockNumber, poolAddress),
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
