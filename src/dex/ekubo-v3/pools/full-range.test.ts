import { DeepReadonly } from 'ts-essentials';
import { FullRangePoolState, quoteFullRange } from './full-range';
import { Quote } from './pool';
import { PoolConfig, PoolKey, StableswapPoolTypeConfig } from './utils';
import { TWO_POW_128 } from './math/constants';
import { MAX_TICK, MIN_TICK } from './math/tick';
import { BigNumber } from 'ethers';
import { ONE_FLOAT_SQRT_RATIO } from './math/sqrt-ratio';

describe(quoteFullRange, () => {
  function quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<FullRangePoolState.Object>,
    fee: bigint,
  ): Quote {
    return quoteFullRange(
      new PoolKey(
        1n,
        2n,
        new PoolConfig(0n, fee, StableswapPoolTypeConfig.fullRangeConfig()),
      ),
      amount,
      isToken1,
      state,
    );
  }

  test('zero liquidity', () => {
    expect(
      quote(
        1000n,
        false,
        {
          liquidity: 0n,
          sqrtRatio: TWO_POW_128,
        },
        0n,
      ).calculatedAmount,
    ).toBe(0n);
  });

  test('with liquidity token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          liquidity: 1_000_000n,
          sqrtRatio: TWO_POW_128,
        },
        0n,
      ).calculatedAmount,
    ).toBe(999n);
  });

  test('with liquidity token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          liquidity: 1_000_000n,
          sqrtRatio: TWO_POW_128,
        },
        0n,
      ).calculatedAmount,
    ).toBe(999n);
  });

  test('with fee', () => {
    expect(
      quote(
        10000n,
        false,
        {
          liquidity: 1_000_000n,
          sqrtRatio: TWO_POW_128,
        },
        2n ** 63n,
      ).calculatedAmount,
    ).toBe(4975n);
  });
});

describe(FullRangePoolState.fromQuoter, () => {
  test('example', () => {
    expect(
      FullRangePoolState.fromQuoter({
        liquidity: BigNumber.from(1),
        maxTick: MAX_TICK,
        minTick: MIN_TICK,
        sqrtRatio: BigNumber.from(ONE_FLOAT_SQRT_RATIO),
        tick: 0,
        ticks: [
          {
            number: MIN_TICK,
            liquidityDelta: BigNumber.from(1),
          },
          {
            number: MAX_TICK,
            liquidityDelta: BigNumber.from(-1),
          },
        ],
      }),
    ).toStrictEqual({
      liquidity: 1n,
      sqrtRatio: TWO_POW_128,
    });
  });
});

describe(FullRangePoolState.fromPositionUpdatedEvent, () => {
  test('zero liquidity delta', () => {
    expect(
      FullRangePoolState.fromPositionUpdatedEvent(
        {
          liquidity: 0n,
          sqrtRatio: TWO_POW_128,
        },
        0n,
      ),
    ).toBe(null);
  });

  test('non-zero liquidity delta', () => {
    expect(
      FullRangePoolState.fromPositionUpdatedEvent(
        {
          liquidity: 0n,
          sqrtRatio: TWO_POW_128,
        },
        1n,
      ),
    ).toEqual({
      liquidity: 1n,
      sqrtRatio: TWO_POW_128,
    });
  });
});

describe(FullRangePoolState.fromSwappedEvent, () => {
  test('example', () => {
    expect(
      FullRangePoolState.fromSwappedEvent({
        liquidityAfter: 0n,
        sqrtRatioAfter: TWO_POW_128,
        tickAfter: 0,
      }),
    ).toStrictEqual<FullRangePoolState.Object>({
      sqrtRatio: TWO_POW_128,
      liquidity: 0n,
    });
  });
});
