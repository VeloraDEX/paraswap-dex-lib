import {
  approximateNumberOfTickSpacingsCrossed,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from './tick';

describe(toSqrtRatio, () => {
  test('min tick', () => {
    expect(toSqrtRatio(MIN_TICK)).toEqual(MIN_SQRT_RATIO);
  });
  test('max tick', () => {
    expect(toSqrtRatio(MAX_TICK)).toEqual(MAX_SQRT_RATIO);
  });
  test('zero', () => {
    expect(toSqrtRatio(0)).toEqual(1n << 128n);
  });

  test('snapshots', () => {
    expect(toSqrtRatio(1e6)).toMatchInlineSnapshot(
      `561030636129153856579134353873645338624n`,
    );
    expect(toSqrtRatio(1e7)).toMatchInlineSnapshot(
      `50502254805927926084423855178401471004672n`,
    );
    expect(toSqrtRatio(-1e6)).toMatchInlineSnapshot(
      `206391740095027370700312310528859963392n`,
    );
    expect(toSqrtRatio(-1e7)).toMatchInlineSnapshot(
      `2292810285051363400276741630355046400n`,
    );
  });
});

describe(approximateNumberOfTickSpacingsCrossed, () => {
  test('same price', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 128n, 1),
    ).toEqual(0);
  });
  test('price doubling 1 tick spacing', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1),
    ).toMatchInlineSnapshot(`5415`);
  });
  test('price doubling 1000 tick spacing', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1000),
    ).toMatchInlineSnapshot(`5`);
  });
  test('max to min', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(MAX_SQRT_RATIO, MIN_SQRT_RATIO, 1),
    ).toMatchInlineSnapshot(`693146`);
  });
  test('min to max', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(MIN_SQRT_RATIO, MAX_SQRT_RATIO, 1),
    ).toMatchInlineSnapshot(`693146`);
  });
  test('min to max 1k tick spacing', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MIN_SQRT_RATIO,
        MAX_SQRT_RATIO,
        1000,
      ),
    ).toMatchInlineSnapshot(`693`);
  });
});
