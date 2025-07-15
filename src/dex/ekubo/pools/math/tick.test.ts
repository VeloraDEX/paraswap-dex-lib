import {
  approximateNumberOfTickSpacingsCrossed,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from './tick';

describe(toSqrtRatio, () => {
  it('min tick', () => {
    expect(toSqrtRatio(MIN_TICK)).toEqual(MIN_SQRT_RATIO);
  });
  it('max tick', () => {
    expect(toSqrtRatio(MAX_TICK)).toEqual(MAX_SQRT_RATIO);
  });
  it('zero', () => {
    expect(toSqrtRatio(0)).toEqual(1n << 128n);
  });

  it('snapshots', () => {
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
  it('same price', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 128n, 1),
    ).toEqual(0);
  });
  it('price doubling 1 tick spacing', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1),
    ).toMatchInlineSnapshot(`5415`);
  });
  it('price doubling 1000 tick spacing', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(1n << 128n, 1n << 129n, 1000),
    ).toMatchInlineSnapshot(`5`);
  });
  it('max to min', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(MAX_SQRT_RATIO, MIN_SQRT_RATIO, 1),
    ).toMatchInlineSnapshot(`693146`);
  });
  it('min to max', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(MIN_SQRT_RATIO, MAX_SQRT_RATIO, 1),
    ).toMatchInlineSnapshot(`693146`);
  });
  it('min to max 1k tick spacing', () => {
    expect(
      approximateNumberOfTickSpacingsCrossed(
        MIN_SQRT_RATIO,
        MAX_SQRT_RATIO,
        1000,
      ),
    ).toMatchInlineSnapshot(`693`);
  });
});
