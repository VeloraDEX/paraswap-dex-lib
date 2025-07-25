import { nextSqrtRatioFromAmount0, nextSqrtRatioFromAmount1 } from './price';

describe(nextSqrtRatioFromAmount0, () => {
  test('add_price_goes_down', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 1000000n, 1000n),
    ).toMatchInlineSnapshot(`339942424496442021441932674757011200256n`);
  });

  test('exact_out_overflow', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 1n, -100000000000000n),
    ).toMatchInlineSnapshot(`null`);
  });

  test('exact_in_cant_underflow', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 1n, 100000000000000n),
    ).toMatchInlineSnapshot(`3402823669209350606397054n`);
  });
  test('sub_price_goes_up', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 100000000000n, -1000n),
    ).toMatchInlineSnapshot(`340282370323762166700996274441730955874n`);
  });
});

describe(nextSqrtRatioFromAmount1, () => {
  test('add_price_goes_up', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 1000000n, 1000n),
    ).toMatchInlineSnapshot(`340622649287859401926837982039199979667n`);
  });

  test('exact_out_overflow', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 1n, -100000000000000n),
    ).toMatchInlineSnapshot(`null`);
  });

  test('exact_in_cant_underflow', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 1n, 100000000000000n),
    ).toMatchInlineSnapshot(
      `34028236692094186628704381681640284520207431768211456n`,
    );
  });

  test('sub_price_goes_down', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 100000000000n, -1000n),
    ).toMatchInlineSnapshot(`340282363518114794253989972798022137138n`);
  });
});
