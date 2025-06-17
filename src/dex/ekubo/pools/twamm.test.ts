import { DeepReadonly } from 'ts-essentials';
import { Quote } from './iface';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from './math/tick';
import { quote, TwammPoolState } from './twamm';
import { PoolConfig, PoolKey } from './utils';

describe('TWAMM pool', () => {
  function quoteTwamm(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<TwammPoolState.Object>,
    timestamp: number,
  ): Quote {
    return quote.bind({
      key: new PoolKey(1n, 2n, new PoolConfig(0, 0n, 3n)),
    })(amount, isToken1, state, timestamp);
  }

  test('zero_sale_rates_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 0n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(999n);
  });

  test('zero_sale_rates_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 0n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(990n);
  });

  test('non_zero_sale_rate_token0_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(999n);
  });

  test('non_zero_sale_rate_token1_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(998n);
  });

  test('non_zero_sale_rate_token1_max_price_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MAX_SQRT_RATIO,
          },
          lastExecutionTime: 0,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(0n);
  });

  test('zero_sale_rate_token0_at_max_price_deltas_move_price_down_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MAX_SQRT_RATIO,
          },
          lastExecutionTime: 0,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16,
              saleRateDelta0: 100_000n * (1n << 32n),
              saleRateDelta1: 0n,
            },
          ],
        },
        32,
      ).calculatedAmount,
    ).toEqual(2555n);
  });

  test('zero_sale_rate_token1_close_at_min_price_deltas_move_price_up_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MIN_SQRT_RATIO,
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [
            {
              time: 16,
              saleRateDelta0: 0n,
              saleRateDelta1: 100_000n * (1n << 32n),
            },
          ],
        },
        32,
      ).calculatedAmount,
    ).toEqual(390n);
  });

  test('zero_sale_rate_token0_at_max_price_deltas_move_price_down_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MAX_SQRT_RATIO,
          },
          lastExecutionTime: 0,
          token0SaleRate: 0n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16,
              saleRateDelta0: 100_000n * (1n << 32n),
              saleRateDelta1: 0n,
            },
          ],
        },
        32,
      ).calculatedAmount,
    ).toEqual(390n);
  });

  test('zero_sale_rate_token1_at_min_price_deltas_move_price_up_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 1_000_000n,
            sqrtRatio: MIN_SQRT_RATIO,
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 0n,
          virtualOrderDeltas: [
            {
              time: 16,
              saleRateDelta0: 0n,
              saleRateDelta1: 100_000n * (1n << 32n),
            },
          ],
        },
        32,
      ).calculatedAmount,
    ).toEqual(2555n);
  });

  test('one_e18_sale_rates_no_sale_rate_deltas_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(990n);
  });

  test('one_e18_sale_rates_no_sale_rate_deltas_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(989n);
  });

  test('token0_sale_rate_greater_than_token1_sale_rate_no_sale_rate_deltas_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 1_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 10n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(717n);
  });

  test('token1_sale_rate_greater_than_token0_sale_rate_no_sale_rate_deltas_quote_token1', () => {
    expect(
      quoteTwamm(
        1000n,
        true,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 10n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(984n);
  });

  test('token0_sale_rate_greater_than_token1_sale_rate_no_sale_rate_deltas_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 10n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(983n);
  });

  test('token1_sale_rate_greater_than_token0_sale_rate_no_sale_rate_deltas_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 10n << 32n,
          virtualOrderDeltas: [],
        },
        32,
      ).calculatedAmount,
    ).toEqual(994n);
  });

  test('sale_rate_deltas_goes_to_zero_halfway_through_execution_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16,
              saleRateDelta0: -(1n << 32n),
              saleRateDelta1: -(1n << 32n),
            },
          ],
        },
        32,
      ).calculatedAmount,
    ).toEqual(989n);
  });

  test('sale_rate_deltas_doubles_halfway_through_execution_quote_token0', () => {
    expect(
      quoteTwamm(
        1000n,
        false,
        {
          fullRangePoolState: {
            liquidity: 100_000n,
            sqrtRatio: toSqrtRatio(1),
          },
          lastExecutionTime: 0,
          token0SaleRate: 1n << 32n,
          token1SaleRate: 1n << 32n,
          virtualOrderDeltas: [
            {
              time: 16,
              saleRateDelta0: 1n << 32n,
              saleRateDelta1: 1n << 32n,
            },
          ],
        },
        32,
      ).calculatedAmount,
    ).toEqual(989n);
  });

  test('compare_to_contract_output', () => {
    expect(
      quoteTwamm(
        10_000n * 10n ** 18n,
        false,
        {
          fullRangePoolState: {
            liquidity: 70_710_696_755_630_728_101_718_334n,
            sqrtRatio: toSqrtRatio(693147),
          },
          lastExecutionTime: 0,
          token0SaleRate: 10_526_880_627_450_980_392_156_862_745n,
          token1SaleRate: 10_526_880_627_450_980_392_156_862_745n,
          virtualOrderDeltas: [],
        },
        2_040,
      ).calculatedAmount,
    ).toEqual(19993991114278789946056n);
  });
});
