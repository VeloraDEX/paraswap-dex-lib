import { DeepReadonly } from 'ts-essentials';
import { OraclePool } from './oracle';
import { FullRangePoolState } from './full-range';
import { PoolConfig, PoolKey } from './utils';
import { Quote } from './pool';
import { TWO_POW_128 } from './math/constants';

describe(OraclePool.prototype.quoteOracle, () => {
  function quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<FullRangePoolState.Object>,
  ): Quote {
    return OraclePool.prototype.quoteOracle.call(
      {
        key: new PoolKey(0n, 1n, new PoolConfig(1n, 0n, 0)),
      },
      amount,
      isToken1,
      state,
    );
  }

  test('token1', () => {
    expect(
      quote(1000n, true, {
        liquidity: 1_000_000_000n,
        sqrtRatio: TWO_POW_128,
      }).calculatedAmount,
    ).toBe(999n);
  });

  test('token0', () => {
    expect(
      quote(1000n, false, {
        liquidity: 1_000_000_000n,
        sqrtRatio: TWO_POW_128,
      }).calculatedAmount,
    ).toBe(999n);
  });
});
