import { quoteXToY, quoteYToX } from './math';
import { LunarBasePoolState } from './types';

const Q96 = 1n << 96n;
const FIVE_PERCENT_Q24 = Math.floor((5 * (1 << 24)) / 100);

const baseState: LunarBasePoolState = {
  anchorPrice: Q96,
  feeAskX24: FIVE_PERCENT_Q24,
  feeBidX24: FIVE_PERCENT_Q24,
  latestUpdateBlock: 100,
  reserveX: 1_000_000n,
  reserveY: 1_000_000n,
  concentrationK: 0,
  blockDelay: 2,
  blacklistFeeMultiplier: 1n,
  paused: false,
};

describe('LunarBase PMM math', () => {
  it('quotes the linear X -> Y fallback with Q24 fee rounding', () => {
    const quote = quoteXToY(baseState, 1_000n, 1n);

    expect(quote.amountOut).toEqual(951n);
    expect(quote.fee).toEqual(49n);
    expect(quote.sqrtPriceNext).toEqual(Q96);
  });

  it('quotes the linear Y -> X fallback with Q24 fee rounding', () => {
    const quote = quoteYToX(baseState, 1_000n, 1n);

    expect(quote.amountOut).toEqual(951n);
    expect(quote.fee).toEqual(49n);
    expect(quote.sqrtPriceNext).toEqual(Q96);
  });

  it('applies the non-whitelisted fee multiplier', () => {
    const quote = quoteXToY(baseState, 1_000n, 2n);

    expect(quote.amountOut).toEqual(902n);
    expect(quote.fee).toEqual(98n);
  });

  it('returns zero when the requested output exceeds reserves', () => {
    const quote = quoteXToY(baseState, 2_000_000n, 1n);

    expect(quote.amountOut).toEqual(0n);
    expect(quote.fee).toEqual(0n);
  });
});
