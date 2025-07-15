import { amount0Delta, amount1Delta } from './delta';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './tick';

describe(amount0Delta, () => {
  it('price_down', () => {
    expect(
      amount0Delta(
        339942424496442021441932674757011200255n,
        0x100000000000000000000000000000000n,
        1000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`1000n`);
  });

  it('price_down_reverse', () => {
    expect(
      amount0Delta(
        0x100000000000000000000000000000000n,
        339942424496442021441932674757011200255n,
        1000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`1000n`);
  });

  it('price example down', () => {
    expect(
      amount0Delta(
        0x100000000000000000000000000000000n,
        34028236692093846346337460743176821145n + (1n << 128n),
        1000000000000000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`90909090909090909n`);
  });
  it('price example up', () => {
    expect(
      amount0Delta(
        0x100000000000000000000000000000000n,
        34028236692093846346337460743176821145n + (1n << 128n),
        1000000000000000000n,
        true,
      ),
    ).toMatchInlineSnapshot(`90909090909090910n`);
  });
});

describe(amount1Delta, () => {
  it('price_down', () => {
    expect(
      amount1Delta(
        339942424496442021441932674757011200255n,
        0x100000000000000000000000000000000n,
        1000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`999n`);
  });
  it('price_down_reverse', () => {
    expect(
      amount1Delta(
        0x100000000000000000000000000000000n,
        339942424496442021441932674757011200255n,
        1000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`999n`);
  });
  it('price_up', () => {
    expect(
      amount1Delta(
        340622989910849312776150758189957120n + (1n << 128n),
        0x100000000000000000000000000000000n,
        1000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`1001n`);
  });
  it('price_up_reverse', () => {
    expect(
      amount1Delta(
        0x100000000000000000000000000000000n,
        339942424496442021441932674757011200255n,
        1000000n,
        true,
      ),
    ).toMatchInlineSnapshot(`1000n`);
  });
  it('price_example_down', () => {
    expect(
      amount1Delta(
        0x100000000000000000000000000000000n,
        309347606291762239512158734028880192232n,
        1000000000000000000n,
        false,
      ),
    ).toMatchInlineSnapshot(`90909090909090909n`);
  });
  it('price_example_up', () => {
    expect(
      amount1Delta(
        0x100000000000000000000000000000000n,
        309347606291762239512158734028880192232n,
        1000000000000000000n,
        true,
      ),
    ).toMatchInlineSnapshot(`90909090909090910n`);
  });
  it('no overflow half price range', () => {
    expect(
      amount1Delta(
        0x100000000000000000000000000000000n,
        MAX_SQRT_RATIO,
        0xffffffffffffffffn,
        false,
      ),
    ).toMatchInlineSnapshot(`340274119756928397675478831269759003622n`);
  });

  it('should panic', () => {
    expect(() =>
      amount1Delta(
        MIN_SQRT_RATIO,
        MAX_SQRT_RATIO,
        0xffffffffffffffffffffffffffffffffn,
        false,
      ),
    ).toThrow('AMOUNT1_DELTA_OVERFLOW_U256');
  });
});
