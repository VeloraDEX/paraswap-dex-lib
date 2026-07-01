import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { testEventSubscriber } from '../../../tests/utils-events';
import { BaselineConfig } from './config';
import { BaselineEventPool } from './baseline-pool';
import { QuoteState } from './types';

/*
  Replays the relay's Swap logs for a block and asserts the state the subscriber
  derives from those events matches the relay's own getQuoteState at that block.
  Each block chosen follows another block the pool traded in, so the block-boundary
  snapshot re-derivation is exercised as the logs are applied.
*/

const network = Network.BASE;
const dexKey = 'Baseline';

const RELAY = BaselineConfig[dexKey][network].relay;
const REPPO = Tokens[network].REPPO;
const VIRTUAL = Tokens[network].VIRTUAL;

// Blocks the pool traded in, each immediately following another traded block.
const blockNumbers: { [eventName: string]: number[] } = {
  Swap: [48065814, 48065998, 48066262, 48066263],
};

describe('Baseline events', () => {
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  Object.entries(blockNumbers).forEach(([event, blocks]) => {
    blocks.forEach(blockNumber => {
      it(`${event}:${blockNumber}`, async () => {
        const pool = new BaselineEventPool(
          dexKey,
          RELAY,
          REPPO.address,
          VIRTUAL.address,
          dexHelper,
          logger,
        );

        await testEventSubscriber(
          pool,
          pool.addressesSubscribed,
          (bn: number) => pool.generateState(bn) as Promise<QuoteState>,
          blockNumber,
          `${dexKey}_${REPPO.address}`,
          dexHelper.provider,
        );
      });
    });
  });
});
