import { DummyDexHelper } from '../../../../dex-helper';
import { Network } from '../../../../constants';
import { PoolKey } from '../../types';
import { SellOnlyHook } from './sell-only-hook';

const dexKey = 'SellOnlyHook';

const poolKey: PoolKey = {
  currency0: '0x96f6ef951840721adbf46ac996b59e0235cb985c', // USDY
  currency1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  fee: '0',
  tickSpacing: 10,
  hooks: '0x56c6038207e87424d3a1dab544526f75761428a0',
};

const swapParams = (zeroForOne: boolean) => ({
  zeroForOne,
  amountSpecified: '-1000000000000000000',
  sqrtPriceLimitX96: '0',
});

describe('SellOnlyHook', () => {
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const hook = new SellOnlyHook(
    dexHelper,
    network,
    dexHelper.getLogger(dexKey),
  );

  it('declares the beforeSwap permission', () => {
    const permissions = hook.getHookPermissions();

    expect(permissions.beforeSwap).toBe(true);
    expect(permissions.afterSwap).toBe(false);
    expect(permissions.beforeSwapReturnDelta).toBe(false);
    expect(permissions.afterSwapReturnDelta).toBe(false);
  });

  it('lets currency0 be sold with no delta and no fee', () => {
    const [selector, delta, fee] = hook.beforeSwap(
      '',
      poolKey,
      swapParams(true),
      '0x',
    );

    expect(selector).toBe('0x575e24b4');
    expect(delta).toEqual({ amount0: 0n, amount1: 0n });
    expect(fee).toBe(0);
  });

  it('reverts a buy', () => {
    expect(() => hook.beforeSwap('', poolKey, swapParams(false), '0x')).toThrow(
      'SellOnly: only currency0 can be sold into the pool',
    );
  });
});
