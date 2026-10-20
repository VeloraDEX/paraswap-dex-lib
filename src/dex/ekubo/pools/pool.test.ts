import { EkuboPool } from './pool';
import { PoolConfig, PoolKey } from './utils';

describe(EkuboPool.prototype.quote, () => {
  test('rounds fractional gas up to an integer', () => {
    const key = new PoolKey(0n, 1n, new PoolConfig(0n, 0n, 1));

    const quote = EkuboPool.prototype.quote.call(
      {
        key,
        getState: () => ({}),
        _quote: () => ({
          consumedAmount: 1n,
          calculatedAmount: 1n,
          gasConsumed: 43_980.2734375,
          skipAhead: 0,
        }),
      } as unknown as EkuboPool<unknown>,
      1n,
      key.token0,
      0,
    );

    expect(quote.gasConsumed).toBe(55_681);
  });
});
