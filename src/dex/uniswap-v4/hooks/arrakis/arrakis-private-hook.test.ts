/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../../../constants';
import { DummyDexHelper } from '../../../../dex-helper';
import { ArrakisPrivateHook } from './arrakis-private-hook';
import { ArrakisPrivateHookConfig } from './config';
import { LPFeeLibrary } from '../../contract-math/LPFeeLibrary';
import { PoolKey } from '../../types';
import { toId } from '../../utils';

jest.setTimeout(60 * 1000);

// real mainnet pool (USDC / OPTIO private vault pool)
const poolKey: PoolKey = {
  currency0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  currency1: '0xa9299c296d7830a99414d1e5546f5171fa01e9c8',
  fee: '8388608', // DYNAMIC_FEE_FLAG
  tickSpacing: 5,
  hooks: '0xa4e6f5500e88691fdcb289aa0e99067481434880',
};

const poolId =
  '0xde31d7cdc7f4db844e87bb67a139ff78afbb8d32e38cce429dbc3a66f1f76dc9';

describe('ArrakisPrivateHook', () => {
  it('has the same address on all configured networks', () => {
    const addresses = Object.values(ArrakisPrivateHookConfig).map(config =>
      config.hookAddress.toLowerCase(),
    );

    expect(addresses.length).toBeGreaterThan(0);
    expect(new Set(addresses).size).toEqual(1);
  });

  it('address flag bits match declared permissions (beforeAddLiquidity + beforeSwap)', () => {
    const dexHelper = new DummyDexHelper(Network.MAINNET);
    const hook = new ArrakisPrivateHook(
      dexHelper,
      Network.MAINNET,
      dexHelper.getLogger('ArrakisPrivateHook'),
    );

    const flags = BigInt(hook.address) & 0x3fffn;
    const BEFORE_ADD_LIQUIDITY_FLAG = 1n << 11n;
    const BEFORE_SWAP_FLAG = 1n << 7n;

    expect(flags).toEqual(BEFORE_ADD_LIQUIDITY_FLAG | BEFORE_SWAP_FLAG);

    const permissions = hook.getHookPermissions();
    expect(permissions.beforeAddLiquidity).toEqual(true);
    expect(permissions.beforeSwap).toEqual(true);
    expect(permissions.afterSwap).toEqual(false);
    expect(permissions.beforeSwapReturnDelta).toEqual(false);
  });

  describe('beforeSwap', () => {
    const dexHelper = new DummyDexHelper(Network.MAINNET);
    let hook: ArrakisPrivateHook;

    beforeEach(() => {
      hook = new ArrakisPrivateHook(
        dexHelper,
        Network.MAINNET,
        dexHelper.getLogger('ArrakisPrivateHook'),
      );
    });

    it('pool key resolves to the expected pool id', () => {
      expect(toId(poolKey).toLowerCase()).toEqual(poolId);
    });

    it('returns directional lp fee override with override flag', () => {
      hook.feeHelper.setState(
        {
          poolIdToFeesData: {
            [poolId]: {
              module: '0xe9e800335d8775488bdfed520cdd22fbfefc4789',
              zeroForOneFee: 200000n,
              oneForZeroFee: 250000n,
            },
          },
        },
        1,
      );

      const swapParams = {
        amountSpecified: '-1000000',
        sqrtPriceLimitX96: '0',
      };

      const [, deltaZeroForOne, feeZeroForOne] = hook.beforeSwap!(
        '0x0000000000000000000000000000000000000000',
        poolKey,
        { ...swapParams, zeroForOne: true },
        '0x',
      );
      expect(BigInt(feeZeroForOne)).toEqual(
        200000n | LPFeeLibrary.OVERRIDE_FEE_FLAG,
      );
      expect(deltaZeroForOne).toEqual({ amount0: 0n, amount1: 0n });

      const [, , feeOneForZero] = hook.beforeSwap!(
        '0x0000000000000000000000000000000000000000',
        poolKey,
        { ...swapParams, zeroForOne: false },
        '0x',
      );
      expect(BigInt(feeOneForZero)).toEqual(
        250000n | LPFeeLibrary.OVERRIDE_FEE_FLAG,
      );
    });

    it('throws when fees were not set for the pool (mirrors ModuleNotSet)', () => {
      hook.feeHelper.setState({ poolIdToFeesData: {} }, 1);

      expect(() =>
        hook.beforeSwap!(
          '0x0000000000000000000000000000000000000000',
          poolKey,
          {
            zeroForOne: true,
            amountSpecified: '-1000000',
            sqrtPriceLimitX96: '0',
          },
          '0x',
        ),
      ).toThrow();
    });
  });
});
