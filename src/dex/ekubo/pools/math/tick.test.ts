import {
  approximateNumberOfTickSpacingsCrossed,
  approximateSqrtRatioToTick,
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
  test('doubling', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MIN_SQRT_RATIO,
        MIN_SQRT_RATIO * 2n,
        0,
      ),
    ).toEqual(0);
    // 2x sqrt ratio increase ~= 4x price increase
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1),
    ).toEqual(1386295);
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MIN_SQRT_RATIO,
        MIN_SQRT_RATIO * 2n,
        1,
      ),
    ).toEqual(1386295);
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MAX_SQRT_RATIO,
        MAX_SQRT_RATIO / 2n,
        1,
      ),
    ).toEqual(1386295);
  });

  test('doubling big tick spacing', () => {
    // 2x sqrt ratio increase ~= 4x price increase
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 5),
    ).toEqual(277259);
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MIN_SQRT_RATIO,
        MIN_SQRT_RATIO * 2n,
        3,
      ),
    ).toEqual(462098);
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MAX_SQRT_RATIO,
        MAX_SQRT_RATIO / 2n,
        200,
      ),
    ).toEqual(6931);
  });
});

describe(approximateSqrtRatioToTick, () => {
  test('examples', () => {
    expect(approximateSqrtRatioToTick(toSqrtRatio(0))).toEqual(0);

    expect(approximateSqrtRatioToTick(toSqrtRatio(1000000))).toEqual(1000000);

    expect(approximateSqrtRatioToTick(toSqrtRatio(10000000))).toEqual(10000000);

    expect(approximateSqrtRatioToTick(toSqrtRatio(-1000000))).toEqual(-1000000);

    expect(approximateSqrtRatioToTick(toSqrtRatio(-10000000))).toEqual(
      -10000000,
    );
  });
});
