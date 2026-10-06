/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { MaverickV2EventPool } from './maverick-v2-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { Tokens } from '../../../tests/constants-e2e';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  maverickV2Pool: MaverickV2EventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  return maverickV2Pool.generateState(blockNumber);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('MaverickV2 EventPool Mainnet', function () {
  const dexKey = 'MaverickV2';
  const network = Network.BASE;
  const tokens = Tokens[network];
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let maverickV2Pool: MaverickV2EventPool;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    '0xe789204A908Fc586743f7b8acbEE9194E5e2Ea73': {
      Swap: [
        14716574, 14845131, 14845133, 14845136, 14845138, 14845141, 14845144,
        14845146, 14845149, 14845151, 14845154, 14845206, 14845209, 14845212,
        14845215, 14845217, 14845220, 14845223, 14845225, 14845228, 14845231,
        14845274, 14845277, 14845279, 14845282, 14845285, 14845287, 14845290,
        14845293, 14845295, 14845298, 14845301, 14845362, 14845364, 14845367,
        14845370, 14845373, 14845375, 14845378, 14845381, 14845383, 14845386,
        14845389, 14845413, 14845416, 14845419, 14845421, 14845424, 14845427,
        14845429, 14845432, 14845435, 14845437, 14845440,
      ],
      AddLiquidity: [
        14762449, 14845350, 14845402, 14845120, 14845195, 14718361, 14845262,
        14716574,
      ],
      RemoveLiquidity: [14845359, 14845203, 14845128, 14845410, 14845271],
    },
  };

  const pools: any = {
    '0xe789204A908Fc586743f7b8acbEE9194E5e2Ea73': {
      tokenA: tokens.DAI,
      tokenB: tokens.USDC,
      feeA: 1000000000000,
      feeB: 1000000000000,
      tickSpacing: 8,
      protocolFee: 0,
      lookback: 360000,
      activeTick: 0,
    },
  };

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        beforeEach(() => {
          let pool = pools[poolAddress];
          maverickV2Pool = new MaverickV2EventPool(
            dexKey,
            network,
            dexHelper,
            logger,
            pool.tokenA,
            pool.tokenB,
            pool.feeA,
            pool.feeB,
            pool.tickSpacing,
            pool.lookback,
            pool.activeTick,
            poolAddress,
            '0x8cf8d1159d8381433556974238c34EB7599321c4',
          );
        });
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    maverickV2Pool,
                    maverickV2Pool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(maverickV2Pool, _blockNumber, poolAddress),
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
