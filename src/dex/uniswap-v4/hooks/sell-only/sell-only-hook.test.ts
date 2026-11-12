import { DummyDexHelper } from '../../../../dex-helper';
import { Network } from '../../../../constants';
import { PoolKey } from '../../types';
import { SellOnlyHook } from './sell-only-hook';
import { SellOnlyOneHook } from './sell-only-one-hook';

const poolKey: PoolKey = {
  currency0: '0x96f6ef951840721adbf46ac996b59e0235cb985c',
  currency1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  fee: '0',
  tickSpacing: 10,
  hooks: '0x56c6038207e87424d3a1dab544526f75761428a0',
};

const swapParams = (zeroForOne: boolean) => ({
  zeroForOne,
  amountSpecified: '-1000000000000000000',
  sqrtPriceLimitX96: '0',
});

describe('SellOnly hooks', () => {
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger('SellOnly');

  it('SellOnlyHook prices a sale of currency0 and refuses a buy', () => {
    const hook = new SellOnlyHook(dexHelper, network, logger);

    expect(hook.beforeSwap('', poolKey, swapParams(true), '0x')).toEqual([
      '0x575e24b4',
      { amount0: 0n, amount1: 0n },
      0,
    ]);
    expect(() => hook.beforeSwap('', poolKey, swapParams(false), '0x')).toThrow(
      'only currency0 can be sold',
    );
  });

  it('SellOnlyOneHook prices a sale of currency1 and refuses a buy', () => {
    const hook = new SellOnlyOneHook(dexHelper, network, logger);

    expect(hook.beforeSwap('', poolKey, swapParams(false), '0x')).toEqual([
      '0x575e24b4',
      { amount0: 0n, amount1: 0n },
      0,
    ]);
    expect(() => hook.beforeSwap('', poolKey, swapParams(true), '0x')).toThrow(
      'only currency1 can be sold',
    );
  });
});
