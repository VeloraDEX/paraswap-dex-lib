import {
  nextSqrtRatioFromAmount0,
  nextSqrtRatioFromAmount1,
} from './sqrt-ratio';

describe(nextSqrtRatioFromAmount0, () => {
  test('add price goes down', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 1000000n, 1000n),
    ).toMatchInlineSnapshot(`339942424496442021441932674757011200256n`);
  });

  test('exact out overflow', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 1n, -100000000000000n),
    ).toMatchInlineSnapshot(`null`);
  });

  test('exact in cant underflow', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 1n, 100000000000000n),
    ).toMatchInlineSnapshot(`3402823669209350606397054n`);
  });
  test('sub price goes up', () => {
    expect(
      nextSqrtRatioFromAmount0(1n << 128n, 100000000000n, -1000n),
    ).toMatchInlineSnapshot(`340282370323762166700996274441730955874n`);
  });
});

describe(nextSqrtRatioFromAmount1, () => {
  test('add price goes up', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 1000000n, 1000n),
    ).toMatchInlineSnapshot(`340622649287859401926837982039199979667n`);
  });

  test('exact out overflow', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 1n, -100000000000000n),
    ).toMatchInlineSnapshot(`null`);
  });

  test('exact in cant underflow', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 1n, 100000000000000n),
    ).toMatchInlineSnapshot(
      `34028236692094186628704381681640284520207431768211456n`,
    );
  });

  test('sub price goes down', () => {
    expect(
      nextSqrtRatioFromAmount1(1n << 128n, 100000000000n, -1000n),
    ).toMatchInlineSnapshot(`340282363518114794253989972798022137138n`);
  });
});
