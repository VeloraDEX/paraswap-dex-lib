import dotenv from 'dotenv';
dotenv.config();

import { LitePsmEventPool } from './lite-psm-event-pool';
import { LitePsmConfig } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';

jest.setTimeout(50 * 1000);
const dexKey = 'LitePsm';
const network = Network.MAINNET;
const config = LitePsmConfig[dexKey][network];

function fetchPoolState(
  makerPsmPool: LitePsmEventPool,
  blockNumber: number,
): Promise<PoolState> {
  return makerPsmPool.generateState(blockNumber);
}

describe('LitePsm Event', function () {
  const blockNumbers: { [eventName: string]: number[] } = {
    // File: [], // never happened
    SellGem: [20559136, 20559876, 20561086, 20563099, 20563672, 20563887],
    BuyGem: [
      20554181, 20555354, 20555452, 20555880, 20556086, 20556431, 20558791,
    ],
  };

  describe('LitePsmEventPool', function () {
    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const makerPsmPool = new LitePsmEventPool(
            dexKey,
            network,
            dexHelper,
            logger,
            config.pools[0],
            config.vatAddress,
          );

          await testEventSubscriber(
            makerPsmPool,
            makerPsmPool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolState(makerPsmPool, _blockNumber),
            blockNumber,
            `${dexKey}_${config.pools[0].psmAddress}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});
