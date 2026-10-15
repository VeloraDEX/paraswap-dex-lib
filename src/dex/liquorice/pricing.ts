import BigNumber from 'bignumber.js';
import { SwapSide } from '../../constants';
import { LiquoriceCurve } from './types';

// Output of one maker's curve for `amount` (human units), or null when the
// maker would not quote it: below its minimum or beyond its depth.
// SELL: amount is src, result is dest. BUY is not supported yet.
export function quoteCurve(
  curve: LiquoriceCurve,
  amount: BigNumber,
  side: SwapSide,
): BigNumber | null {
  if (side === SwapSide.BUY) return null;
  if (amount.lte(0) || amount.lt(curve.minAmount)) return null;

  let remaining = amount;
  let output = new BigNumber(0);

  for (const [price, size] of curve.levels) {
    const fill = BigNumber.min(size, remaining);
    output = output.plus(fill.times(price));
    remaining = remaining.minus(fill);
    if (remaining.lte(0)) return output;
  }

  return null;
}

// A single maker fills the whole leg, so curves are never summed: the best
// curve that can quote the amount wins.
export function bestQuote(
  curves: LiquoriceCurve[],
  amount: BigNumber,
  side: SwapSide,
): BigNumber | null {
  let best: BigNumber | null = null;

  for (const curve of curves) {
    const quote = quoteCurve(curve, amount, side);
    if (quote && (!best || quote.gt(best))) best = quote;
  }

  return best;
}

// Total src a curve can absorb and the dest it pays for it.
export function curveDepth(curve: LiquoriceCurve): {
  src: BigNumber;
  dest: BigNumber;
} {
  return curve.levels.reduce(
    (acc, [price, size]) => ({
      src: acc.src.plus(size),
      dest: acc.dest.plus(new BigNumber(size).times(price)),
    }),
    { src: new BigNumber(0), dest: new BigNumber(0) },
  );
}
