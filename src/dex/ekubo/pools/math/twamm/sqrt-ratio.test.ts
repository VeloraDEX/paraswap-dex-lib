import { calculateNextSqrtRatio } from './sqrt-ratio';

describe(calculateNextSqrtRatio, () => {
  const ONE_E18 = 1_000_000_000_000_000_000n; // 10^18
  const SHIFT_32 = 1n << 32n; // 2^32 = 4294967296
  const TOKEN_SALE_RATE = ONE_E18 * SHIFT_32; // 10^18 * 2^32

  const TEST_CASES = [
    {
      description: 'zero_liquidity_price_eq_sale_ratio',
      sqrt_ratio: 0n,
      liquidity: 0n,
      token0_sale_rate: TOKEN_SALE_RATE,
      token1_sale_rate: TOKEN_SALE_RATE,
      time_elapsed: 0,
      fee: 0n,
      expected: 340282366920938463463374607431768211456n,
    },
    {
      description: 'large_exponent_price_sqrt_ratio',
      sqrt_ratio: 1n << 128n,
      liquidity: 1n,
      token0_sale_rate: TOKEN_SALE_RATE,
      token1_sale_rate: 1980n * ONE_E18 * SHIFT_32,
      time_elapsed: 1,
      fee: 0n,
      expected: 15141609448466370575828005229206655991808n,
    },
    {
      description: 'low_liquidity_same_sale_ratio',
      sqrt_ratio: 2n << 128n,
      liquidity: 1n,
      token0_sale_rate: TOKEN_SALE_RATE,
      token1_sale_rate: TOKEN_SALE_RATE,
      time_elapsed: 1,
      fee: 0n,
      expected: 340282366920938463463374607431768211456n,
    },
    {
      description: 'low_liquidity_token0_gt_token1',
      sqrt_ratio: 1n << 128n,
      liquidity: 1n,
      token0_sale_rate: 2n * TOKEN_SALE_RATE,
      token1_sale_rate: TOKEN_SALE_RATE,
      time_elapsed: 16,
      fee: 0n,
      expected: 240615969168004511545033772477625056927n,
    },
    {
      description: 'low_liquidity_token1_gt_token0',
      sqrt_ratio: 1n << 128n,
      liquidity: 1n,
      token0_sale_rate: TOKEN_SALE_RATE,
      token1_sale_rate: 2n * TOKEN_SALE_RATE,
      time_elapsed: 16,
      fee: 0n,
      expected: 481231938336009023090067544951314448384n,
    },
    {
      description: 'high_liquidity_same_sale_rate',
      sqrt_ratio: 2n << 128n,
      liquidity: 1_000_000n * ONE_E18,
      token0_sale_rate: TOKEN_SALE_RATE,
      token1_sale_rate: TOKEN_SALE_RATE,
      time_elapsed: 1,
      fee: 0n,
      expected: 680563712996817890757827685335626524191n,
    },
    {
      description: 'high_liquidity_token0_gt_token1',
      sqrt_ratio: 1n << 128n,
      liquidity: 1_000_000n * ONE_E18,
      token0_sale_rate: 2n * TOKEN_SALE_RATE,
      token1_sale_rate: TOKEN_SALE_RATE,
      time_elapsed: 1,
      fee: 0n,
      expected: 340282026639252118183347287047607050305n,
    },
    {
      description: 'high_liquidity_token1_gt_token0',
      sqrt_ratio: 1n << 128n,
      liquidity: 1_000_000n * ONE_E18,
      token0_sale_rate: TOKEN_SALE_RATE,
      token1_sale_rate: 2n * TOKEN_SALE_RATE,
      time_elapsed: 1,
      fee: 0n,
      expected: 340282707202965090089453576058304747105n,
    },
    {
      description: 'round_in_direction_of_price',
      sqrt_ratio: 481231811499356508086519009265716982182n,
      liquidity: 70_710_696_755_630_728_101_718_334n,
      token0_sale_rate: 10_526_880_627_450_980_392_156_862_745n,
      token1_sale_rate: 10_526_880_627_450_980_392_156_862_745n,
      time_elapsed: 2040,
      fee: 0n,
      expected: 481207752340104468493822013619596511452n,
    },
  ];

  for (const testCase of TEST_CASES) {
    test(testCase.description, () => {
      expect(
        calculateNextSqrtRatio(
          testCase.sqrt_ratio,
          testCase.liquidity,
          testCase.token0_sale_rate,
          testCase.token1_sale_rate,
          testCase.time_elapsed,
          testCase.fee,
        ),
      ).toEqual(testCase.expected);
    });
  }

  test('zero_liquidity_price_eq_sale_ratio', () => {});
});
