import { DeepReadonly } from 'ts-essentials';
import { Quote } from './pool';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from './math/tick';
import { TwammPool, TwammPoolState } from './twamm';
import { PoolConfig, PoolKey, StableswapPoolTypeConfig } from './utils';
import { TWO_POW_128 } from './math/constants';
import { BigNumber } from 'ethers';
import { fixedSqrtRatioToFloat } from './math/sqrt-ratio';

describe(TwammPool.prototype.quoteTwamm, () => {
  function quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<TwammPoolState.Object>,
    timestamp: bigint,
  ): Quote {
    return TwammPool.prototype.quoteTwamm.call(
      {
        key: new PoolKey(
          1n,
          2n,
          new PoolConfig(3n, 0n, StableswapPoolTypeConfig.fullRangeConfig()),
        ),
      },
      amount,
      isToken1,
      state,
      timestamp,
    );
  }

  test('zero sale rates quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 0n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(999n);
  });

  test('zero sale rates quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 0n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(990n);
  });

  test('non zero sale rate token0 quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(999n);
  });

  test('non zero sale rate token1 quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(998n);
  });

  test('non zero sale rate token1 max price quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MAX_SQRT_RATIO,
          },
          lastExecutionTime: 0n,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(0n);
  });

  test('zero sale rate token0 at max price deltas move price down quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MAX_SQRT_RATIO,
          },
          lastExecutionTime: 0n,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16n,
              saleRateDelta0: 100_000n * (1n << 32n),
              saleRateDelta1: 0n,
            },
          ],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(2555n);
  });

  test('zero sale rate token1 close at min price deltas move price up quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MIN_SQRT_RATIO,
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [
            {
              time: 16n,
              saleRateDelta0: 0n,
              saleRateDelta1: 100_000n * (1n << 32n),
            },
          ],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(390n);
  });

  test('zero sale rate token0 at max price deltas move price down quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MAX_SQRT_RATIO,
          },
          lastExecutionTime: 0n,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16n,
              saleRateDelta0: 100_000n * (1n << 32n),
              saleRateDelta1: 0n,
            },
          ],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(390n);
  });

  test('zero sale rate token1 at min price deltas move price up quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MIN_SQRT_RATIO,
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [
            {
              time: 16n,
              saleRateDelta0: 0n,
              saleRateDelta1: 100_000n * (1n << 32n),
            },
          ],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(2555n);
  });

  test('one e18 sale rates no sale rate deltas quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(990n);
  });

  test('one e18 sale rates no sale rate deltas quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(989n);
  });

  test('token0 sale rate greater than token1 sale rate no sale rate deltas quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 10n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(717n);
  });

  test('token1 sale rate greater than token0 sale rate no sale rate deltas quote token1', () => {
    expect(
      quote(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 10n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(984n);
  });

  test('token0 sale rate greater than token1 sale rate no sale rate deltas quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 10n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(983n);
  });

  test('token1 sale rate greater than token0 sale rate no sale rate deltas quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 10n << 32n,
          virtualOrderDeltas: [],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(994n);
  });

  test('sale rate deltas goes to zero halfway through execution quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16n,
              saleRateDelta0: -(1n << 32n),
              saleRateDelta1: -(1n << 32n),
            },
          ],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(989n);
  });

  test('sale rate deltas doubles halfway through execution quote token0', () => {
    expect(
      quote(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16n,
              saleRateDelta0: 1n << 32n,
              saleRateDelta1: 1n << 32n,
            },
          ],
        },
        32n,
      ).calculatedAmount,
    ).toEqual(989n);
  });

  test('compare to contract output', () => {
    expect(
      quote(
        10_000n * 10n ** 18n,
        false,
        {
          fullRangePoolState: {
            liquidity: 70_710_696_755_630_728_101_718_334n,
            sqrtRatio: toSqrtRatio(693147),
          },
          lastExecutionTime: 0n,
          token0SaleRate: 10_526_880_627_450_980_392_156_862_745n,
          token1SaleRate: 10_526_880_627_450_980_392_156_862_745n,
          virtualOrderDeltas: [],
        },
        2_040n,
      ).calculatedAmount,
    ).toEqual(19993991114278789946056n);
  });
});

function poolState(): TwammPoolState.Object {
  return {
    fullRangePoolState: {
      liquidity: 1n,
      sqrtRatio: TWO_POW_128,
    },
    lastExecutionTime: 0n,
    token0SaleRate: 1n,
    token1SaleRate: 1n,
    virtualOrderDeltas: [
      {
        time: 2n,
        saleRateDelta0: -1n,
        saleRateDelta1: 1n,
      },
      {
        time: 3n,
        saleRateDelta0: 2n,
        saleRateDelta1: -2n,
      },
    ],
  };
}

describe(TwammPoolState.fromQuoter, () => {
  test('example', () => {
    const expected = poolState();

    expect(
      TwammPoolState.fromQuoter({
        liquidity: BigNumber.from(expected.fullRangePoolState.liquidity),
        lastVirtualOrderExecutionTime: BigNumber.from(
          expected.lastExecutionTime,
        ),
        saleRateDeltas: expected.virtualOrderDeltas.map(delta => ({
          time: BigNumber.from(delta.time),
          saleRateDelta0: BigNumber.from(delta.saleRateDelta0),
          saleRateDelta1: BigNumber.from(delta.saleRateDelta1),
        })),
        saleRateToken0: BigNumber.from(expected.token0SaleRate),
        saleRateToken1: BigNumber.from(expected.token1SaleRate),
        sqrtRatio: BigNumber.from(
          fixedSqrtRatioToFloat(expected.fullRangePoolState.sqrtRatio),
        ),
      }),
    ).toStrictEqual(expected);
  });
});

describe(TwammPoolState.fromSwappedEvent, () => {
  test('example', () => {
    const state = poolState();

    const [liquidityAfter, sqrtRatioAfter] = [
      state.fullRangePoolState.liquidity + 1n,
      state.fullRangePoolState.sqrtRatio + 1n,
    ];

    const stateAfterSwap = TwammPoolState.fromSwappedEvent(state, {
      liquidityAfter,
      sqrtRatioAfter,
      tickAfter: 0,
    });

    const expected = structuredClone(state);
    expected.fullRangePoolState.liquidity = liquidityAfter;
    expected.fullRangePoolState.sqrtRatio = sqrtRatioAfter;

    expect(stateAfterSwap).toStrictEqual(expected);
  });
});

describe(TwammPoolState.fromPositionUpdatedEvent, () => {
  test('zero liquidity delta', () => {
    expect(TwammPoolState.fromPositionUpdatedEvent(poolState(), 0n)).toBe(null);
  });

  test('non-zero liquidity delta', () => {
    const state = poolState();

    const expected = structuredClone(state);
    expected.fullRangePoolState.liquidity += 1n;

    expect(TwammPoolState.fromPositionUpdatedEvent(state, 1n)).toStrictEqual(
      expected,
    );
  });
});

describe(TwammPoolState.fromVirtualOrdersExecutedEvent, () => {
  test('no old delta removal', () => {
    const state = poolState();
    const timestamp = 1n;

    const expected = structuredClone(state);
    expected.lastExecutionTime = timestamp;

    expect(
      TwammPoolState.fromVirtualOrdersExecutedEvent(
        state,
        {
          token0SaleRate: state.token0SaleRate,
          token1SaleRate: state.token1SaleRate,
        },
        timestamp,
      ),
    ).toStrictEqual(expected);
  });

  test('old delta removal', () => {
    const state = poolState();

    const timestamp = 3n;
    const [newToken0SaleRate, newToken1SaleRate] = [2n, 0n];

    const expected = structuredClone(state);
    expected.lastExecutionTime = timestamp;
    expected.token0SaleRate = newToken0SaleRate;
    expected.token1SaleRate = newToken1SaleRate;
    expected.virtualOrderDeltas = [];

    expect(
      TwammPoolState.fromVirtualOrdersExecutedEvent(
        state,
        {
          token0SaleRate: newToken0SaleRate,
          token1SaleRate: newToken1SaleRate,
        },
        timestamp,
      ),
    ).toStrictEqual(expected);
  });
});

describe(TwammPoolState.fromOrderUpdatedEvent, () => {
  test('already started & new time', () => {
    const state = poolState();

    const endTime = 100n;
    const srd = 1n;

    const expected = structuredClone(state);
    expected.token1SaleRate += srd;
    expected.virtualOrderDeltas.push({
      time: endTime,
      saleRateDelta0: 0n,
      saleRateDelta1: -srd,
    });

    expect(
      TwammPoolState.fromOrderUpdatedEvent(
        state,
        [state.lastExecutionTime, endTime],
        srd,
        true,
      ),
    ).toStrictEqual(expected);
  });

  test('not started & existing times', () => {
    const state = poolState();

    const [startTime, endTime] = [2n, 3n];
    const srd = 1n;

    const expected = structuredClone(state);
    expected.virtualOrderDeltas[0].saleRateDelta1 += srd;
    expected.virtualOrderDeltas[1].saleRateDelta1 -= srd;

    expect(
      TwammPoolState.fromOrderUpdatedEvent(
        state,
        [startTime, endTime],
        srd,
        true,
      ),
    ).toStrictEqual(expected);
  });
});
