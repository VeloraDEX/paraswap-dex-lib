import dotenv from 'dotenv';
dotenv.config();

import { DeepReadonly } from 'ts-essentials';
import { StabullEventPool } from './stabull-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolConfig, PoolState } from './types';
import { PromiseScheduler } from '../../lib/promise-scheduler';

// DummyDexHelper starts a recurring scheduler even when this test queues no work.
const schedulerRun = jest
  .spyOn(PromiseScheduler.prototype as any, 'run')
  .mockImplementation(() => undefined);
afterAll(() => schedulerRun.mockRestore());

jest.setTimeout(120 * 1000);

// Fetch an independent on-chain snapshot for comparison with replayed state.
async function fetchPoolState(
  stabullPool: StabullEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<DeepReadonly<PoolState>> {
  return stabullPool.generateState(blockNumber);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Stabull EventPool Polygon', function () {
  const dexKey = 'Stabull';
  const network = Network.POLYGON;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let stabullPool: StabullEventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    // BRZ/USDC pool. AnswerUpdated logs come from the listed oracle
    // aggregators; Transfer logs come from the BRZ token.
    '0xce0abd182d2cf5844f2a0cb52cfcc55d4ff4fcba': {
      AnswerUpdated: [
        96674264, // BRZ feed aggregator: 0x96708ee1E2edF130E1A9e5c3550dD2aa37f9a49c
        96670009, // USDC feed aggregator: 0x51E9881835aD37b1fBBe23620E23aBA902C0d266
      ],
      Transfer: [
        90276516, // BRZ transfer out of the pool
        96668308, // BRZ transfer into the pool
      ],
      Trade: [95000594],
    },
    // PHP pool on Polygon; verified FrozenSet(true) event.
    '0x1233003461F654cf1c0d7dB19e753BAdef05A87f': {
      FrozenSet: [74379977],
    },
  };

  // Constructor fixtures from each pool's AssetIncluded creation logs.
  const halfWeight = (1n << 63n) + 18n;
  const pools: Record<Address, PoolConfig> = {
    '0xce0abd182d2cf5844f2a0cb52cfcc55d4ff4fcba': {
      address: '0xce0abd182d2cf5844f2a0cb52cfcc55d4ff4fcba',
      tokens: [
        '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc',
        '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      ],
      weights: [halfWeight, halfWeight],
    },
    '0x1233003461F654cf1c0d7dB19e753BAdef05A87f': {
      address: '0x1233003461F654cf1c0d7dB19e753BAdef05A87f',
      tokens: [
        '0x87a25dc121db52369f4a9971f664ae5e372cf69a',
        '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      ],
      weights: [halfWeight, halfWeight],
    },
  };

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        beforeEach(() => {
          const pool = pools[poolAddress];
          stabullPool = new StabullEventPool(
            dexKey,
            pool,
            dexHelper,
            logger,
            '0x3bb4c6e22703e33a90b4abedc71fcf6fe38f3ebd',
            `${dexKey}_${poolAddress}`,
          );
        });
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  // Resolve oracle aggregators before the helper fetches subscribed logs.
                  await stabullPool.initialize(blockNumber - 1);
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
