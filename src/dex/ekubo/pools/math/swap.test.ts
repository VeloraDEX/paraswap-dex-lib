import {
  amountBeforeFee,
  computeFee,
  computeStep,
  isPriceIncreasing,
} from './swap';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './tick';

describe(isPriceIncreasing, () => {
  test('many cases', () => {
    expect(isPriceIncreasing(0n, false)).toBe(false);
    expect(isPriceIncreasing(1n, false)).toBe(false);
    expect(isPriceIncreasing(-1n, false)).toBe(true);
    expect(isPriceIncreasing(0n, true)).toBe(true);
    expect(isPriceIncreasing(1n, true)).toBe(true);
    expect(isPriceIncreasing(-1n, true)).toBe(false);
  });
});

describe(amountBeforeFee, () => {
  it('rounds up', () => {
    expect(amountBeforeFee(105n, (1n << 64n) / 100n)).toMatchInlineSnapshot(
      `107n`,
    );
  });
});

describe(computeFee, () => {
  it('rounds up', () => {
    expect(computeFee(105n, (1n << 64n) / 100n)).toMatchInlineSnapshot(`2n`);
  });
  it('rounds evenly', () => {
    expect(computeFee(100n, (1n << 64n) / 100n)).toMatchInlineSnapshot(`1n`);
  });
});

describe(computeStep, () => {
  test('zero amount token0', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0n,
        amount: 0n,
        isToken1: false,
        fee: 0n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 0n,
  "consumedAmount": 0n,
  "feeAmount": 0n,
  "sqrtRatioNext": 340282366920938463463374607431768211456n,
}
`);
  });
  test('zero amount token1', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0n,
        amount: 0n,
        isToken1: true,
        fee: 0n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 0n,
  "consumedAmount": 0n,
  "feeAmount": 0n,
  "sqrtRatioNext": 340282366920938463463374607431768211456n,
}
`);
  });
  test('swap ratio equal limit token1', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0x100000000000000000000000000000000n,
        amount: 10000n,
        isToken1: true,
        fee: 0n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 0n,
  "consumedAmount": 0n,
  "feeAmount": 0n,
  "sqrtRatioNext": 340282366920938463463374607431768211456n,
}
`);
  });

  test('max limit token0 input', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MIN_SQRT_RATIO,
        amount: 10000n,
        isToken1: false,
        fee: 1n << 63n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 4761n,
  "consumedAmount": 10000n,
  "feeAmount": 5000n,
  "sqrtRatioNext": 324078444686608060441309149935017344244n,
}
`);
  });

  test('max limit token1 input', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MAX_SQRT_RATIO,
        amount: 10000n,
        isToken1: true,
        fee: 1n << 63n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 4761n,
  "consumedAmount": 10000n,
  "feeAmount": 5000n,
  "sqrtRatioNext": 357296485266985386636543337803356622028n,
}
`);
  });

  test('max limit token0 output', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MAX_SQRT_RATIO,
        amount: -10000n,
        isToken1: false,
        fee: 1n << 63n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 22224n,
  "consumedAmount": -10000n,
  "feeAmount": 11112n,
  "sqrtRatioNext": 378091518801042737181527341590853568285n,
}
`);
  });

  test('max limit token1 output', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MIN_SQRT_RATIO,
        amount: -10000n,
        isToken1: true,
        fee: 1n << 63n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 22224n,
  "consumedAmount": -10000n,
  "feeAmount": 11112n,
  "sqrtRatioNext": 306254130228844617117037146688591390310n,
}
`);
  });

  test('limited token0 output', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 359186942860990600322450974511310889870n,
        amount: -10000n,
        isToken1: false,
        fee: 1n << 63n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 11112n,
  "consumedAmount": -5263n,
  "feeAmount": 5556n,
  "sqrtRatioNext": 359186942860990600322450974511310889870n,
}
`);
  });

  test('limited token1 output', () => {
    expect(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 323268248574891540290205877060179800883n,
        amount: -10000n,
        isToken1: true,
        fee: 1n << 63n,
      }),
    ).toMatchInlineSnapshot(`
{
  "calculatedAmount": 10528n,
  "consumedAmount": -5000n,
  "feeAmount": 5264n,
  "sqrtRatioNext": 323268248574891540290205877060179800883n,
}
`);
  });
});
