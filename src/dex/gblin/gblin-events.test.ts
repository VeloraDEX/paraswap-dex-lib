/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { GblinEventPool } from './gblin-pool';
import { GblinConfig } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { GblinPoolState } from './types';

jest.setTimeout(120 * 1000);

const network = Network.BASE;
const dexKey = 'Gblin';
const { vault, lens, feedAggregators } = GblinConfig[dexKey][network];

async function fetchPoolState(
  pool: GblinEventPool,
  blockNumber: number,
): Promise<GblinPoolState> {
  return pool.generateState(blockNumber);
}

// Blocks on Base with a vault event (mints of the vault in service) and with Chainlink
// AnswerUpdated events on the aggregators the vault reads.
const eventBlocks: Record<string, number[]> = {
  Minted: [51743557, 51742745, 51742251],
  AnswerUpdated: [51743557, 51742745],
};

describe('Gblin EventPool Base', function () {
  const blockNumbers = Array.from(
    new Set(Object.values(eventBlocks).flat()),
  ).sort((a, b) => a - b);

  blockNumbers.forEach((blockNumber: number) => {
    it(`state after block ${blockNumber}`, async function () {
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);
      const pool = new GblinEventPool(
        dexKey,
        network,
        dexHelper,
        logger,
        vault,
        lens,
        feedAggregators,
      );

      await testEventSubscriber(
        pool,
        pool.addressesSubscribed,
        (_blockNumber: number) => fetchPoolState(pool, _blockNumber),
        blockNumber,
        `${dexKey}_${vault}`,
        dexHelper.provider,
      );
    });
  });
});
