/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { LunarBaseEventPool } from './lunar-base-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { LUNAR_BASE_DEFAULT_FEE_CONFIG } from './types';

const dexKey = 'LunarBase';
const network = Network.BASE;

const poolAddress = '0x3ba5489420cc9274faeb62d3aca073a8c9a70d84';
const token0 = '0x4200000000000000000000000000000000000006';
const token1 = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const blockWithSync = 0;

describe('LunarBase Events', function () {
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  describe('LunarBaseEventPool', () => {
    it('should generate initial state from on-chain', async () => {
      const baseFeeConfig = {
        baseFee: 450000,
        wToken0: 0,
        wToken1: 1000000000,
      };

      const pool = new LunarBaseEventPool(
        dexKey,
        dexHelper,
        poolAddress,
        { address: token0 },
        { address: token1 },
        baseFeeConfig,
        logger,
      );

      const state = await pool.generateState();

      expect(state.reserves0).toBeDefined();
      expect(state.reserves1).toBeDefined();
      expect(BigInt(state.reserves0)).toBeGreaterThan(0n);
      expect(BigInt(state.reserves1)).toBeGreaterThan(0n);
      expect(state.baseFeeConfig).toEqual(baseFeeConfig);
    });

    it('should handle Sync events', async () => {
      if (blockWithSync === 0) {
        return;
      }

      const baseFeeConfig = {
        baseFee: 450000,
        wToken0: 0,
        wToken1: 1000000000,
      };

      const pool = new LunarBaseEventPool(
        dexKey,
        dexHelper,
        poolAddress,
        { address: token0 },
        { address: token1 },
        baseFeeConfig,
        logger,
      );

      await testEventSubscriber(
        pool,
        pool.addressesSubscribed,
        (fetchedState: any) => fetchedState,
        blockWithSync,
        `${dexKey}_${poolAddress}`,
        dexHelper.provider,
      );
    });
  });
});
