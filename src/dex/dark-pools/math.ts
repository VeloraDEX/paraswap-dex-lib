import { DarkPoolsPoolState, DarkPoolsQuoteResult } from './types';

const Q12 = 1n << 12n;
const Q24 = 1n << 24n;
const Q48 = 1n << 48n;
const Q96 = 1n << 96n;
const MAX_U160 = (1n << 160n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('mulDiv division by zero');
  return (a * b) / denominator;
}

function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('mulDiv division by zero');
  const product = a * b;
  return product === 0n ? 0n : (product - 1n) / denominator + 1n;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('ceilDiv division by zero');
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

function sqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('square root of negative number');
  if (value < 2n) return value;

  let x0 = value;
  let x1 = (value >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + value / x1) >> 1n;
  }
  return x0;
}

function applyFee(
  grossOutput: bigint,
  feeQ24: number,
  feeMultiplier: bigint,
): [amountOut: bigint, fee: bigint] {
  const baseFee = mulDiv(grossOutput, BigInt(feeQ24), Q24);
  if (feeMultiplier <= 1n || baseFee === 0n) {
    return [grossOutput - baseFee, baseFee];
  }

  if (feeMultiplier > MAX_U256 / baseFee) return [0n, grossOutput];

  const fee = baseFee * feeMultiplier;
  if (fee >= grossOutput) return [0n, grossOutput];

  return [grossOutput - fee, fee];
}

function concentrationQ48(
  anchorPrice: bigint,
  amountIn: bigint,
  reserveX: bigint,
  reserveY: bigint,
  concentrationK: number,
  xToY: boolean,
): bigint {
  if (amountIn === 0n || concentrationK === 0 || anchorPrice === 0n) return 0n;

  const xWealthInY = mulDiv(
    mulDiv(reserveX, anchorPrice, Q96),
    anchorPrice,
    Q96,
  );
  const totalWealthInY = xWealthInY + reserveY;
  if (totalWealthInY === 0n) return 0n;

  const amountInWealth = xToY
    ? mulDiv(mulDiv(amountIn, anchorPrice, Q96), anchorPrice, Q96)
    : amountIn;

  const rQ48 =
    amountInWealth >= totalWealthInY
      ? Q48
      : mulDiv(amountInWealth, Q48, totalWealthInY);
  const rSquaredQ48 = mulDiv(rQ48, rQ48, Q48);
  const cQ48 = mulDiv(BigInt(concentrationK), rSquaredQ48, Q12);

  return cQ48 >= Q48 ? Q48 : cQ48;
}

function lowerBound(anchorPrice: bigint, cQ48: bigint): bigint {
  const oneMinusConcentrationQ48 = Q48 - cQ48;
  return mulDiv(anchorPrice, sqrt(oneMinusConcentrationQ48), Q24);
}

function upperBound(anchorPrice: bigint, cQ48: bigint): bigint {
  const oneMinusConcentrationQ48 = Q48 - cQ48;
  return mulDiv(anchorPrice, Q24, sqrt(oneMinusConcentrationQ48));
}

function ly(anchorPrice: bigint, lower: bigint, reserveY: bigint): bigint {
  return mulDiv(reserveY, Q96, anchorPrice - lower);
}

function lx(anchorPrice: bigint, upper: bigint, reserveX: bigint): bigint {
  const priceProductX96 = mulDiv(anchorPrice, upper, Q96);
  return mulDiv(reserveX, priceProductX96, upper - anchorPrice);
}

function getAmountXDelta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [sa, sb] =
    sqrtRatioA > sqrtRatioB
      ? [sqrtRatioB, sqrtRatioA]
      : [sqrtRatioA, sqrtRatioB];
  if (sa === 0n) throw new Error('invalid sqrtRatioAX96');

  const numerator1 = liquidity << 96n;
  const numerator2 = sb - sa;

  if (roundUp) {
    return ceilDiv(mulDivRoundingUp(numerator1, numerator2, sb), sa);
  }

  return mulDiv(numerator1, numerator2, sb) / sa;
}

function getAmountYDelta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [sa, sb] =
    sqrtRatioA > sqrtRatioB
      ? [sqrtRatioB, sqrtRatioA]
      : [sqrtRatioA, sqrtRatioB];
  const diff = sb - sa;

  return roundUp
    ? mulDivRoundingUp(liquidity, diff, Q96)
    : mulDiv(liquidity, diff, Q96);
}

function getNextSqrtPriceFromAmountXRoundingUp(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountX: bigint,
): bigint {
  if (amountX === 0n) return sqrtPX96;

  const numerator1 = liquidity << 96n;
  const product = amountX * sqrtPX96;

  if (product <= MAX_U256) {
    const denominator = numerator1 + product;
    if (denominator <= MAX_U256 && denominator >= numerator1) {
      return mulDivRoundingUp(numerator1, sqrtPX96, denominator);
    }
  }

  return ceilDiv(numerator1, numerator1 / sqrtPX96 + amountX);
}

function getNextSqrtPriceFromAmountYRoundingDown(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountY: bigint,
): bigint {
  const quotient =
    amountY <= MAX_U160
      ? (amountY << 96n) / liquidity
      : mulDiv(amountY, Q96, liquidity);

  return sqrtPX96 + quotient;
}

function linearXToY(
  state: DarkPoolsPoolState,
  amountIn: bigint,
  feeMultiplier: bigint,
): DarkPoolsQuoteResult {
  const dy = mulDiv(
    mulDiv(amountIn, state.anchorPrice, Q96),
    state.anchorPrice,
    Q96,
  );
  if (dy === 0n || dy > state.reserveY) {
    return { amountOut: 0n, sqrtPriceNext: state.anchorPrice, fee: 0n };
  }

  const [amountOut, fee] = applyFee(dy, state.feeBidX24, feeMultiplier);
  return { amountOut, sqrtPriceNext: state.anchorPrice, fee };
}

function linearYToX(
  state: DarkPoolsPoolState,
  amountIn: bigint,
  feeMultiplier: bigint,
): DarkPoolsQuoteResult {
  if (state.anchorPrice === 0n) {
    return { amountOut: 0n, sqrtPriceNext: state.anchorPrice, fee: 0n };
  }

  const dx = mulDiv(
    mulDiv(amountIn, Q96, state.anchorPrice),
    Q96,
    state.anchorPrice,
  );
  if (dx === 0n || dx > state.reserveX) {
    return { amountOut: 0n, sqrtPriceNext: state.anchorPrice, fee: 0n };
  }

  const [amountOut, fee] = applyFee(dx, state.feeAskX24, feeMultiplier);
  return { amountOut, sqrtPriceNext: state.anchorPrice, fee };
}

export function quoteXToY(
  state: DarkPoolsPoolState,
  amountIn: bigint,
  feeMultiplier: bigint,
): DarkPoolsQuoteResult {
  const zero = { amountOut: 0n, sqrtPriceNext: state.anchorPrice, fee: 0n };
  const cQ48 = concentrationQ48(
    state.anchorPrice,
    amountIn,
    state.reserveX,
    state.reserveY,
    state.concentrationK,
    true,
  );

  if (cQ48 === 0n) return linearXToY(state, amountIn, feeMultiplier);
  if (cQ48 >= Q48) return zero;

  const lower = lowerBound(state.anchorPrice, cQ48);
  if (state.anchorPrice <= lower) return zero;

  const liquidity = ly(state.anchorPrice, lower, state.reserveY);
  const maxNetDx = getAmountXDelta(lower, state.anchorPrice, liquidity, false);
  if (amountIn > maxNetDx) return zero;

  const sqrtPriceNext = getNextSqrtPriceFromAmountXRoundingUp(
    state.anchorPrice,
    liquidity,
    amountIn,
  );
  const dy = getAmountYDelta(
    state.anchorPrice,
    sqrtPriceNext,
    liquidity,
    false,
  );
  const [amountOut, fee] = applyFee(dy, state.feeBidX24, feeMultiplier);

  return { amountOut, sqrtPriceNext, fee };
}

export function quoteYToX(
  state: DarkPoolsPoolState,
  amountIn: bigint,
  feeMultiplier: bigint,
): DarkPoolsQuoteResult {
  const zero = { amountOut: 0n, sqrtPriceNext: state.anchorPrice, fee: 0n };
  const cQ48 = concentrationQ48(
    state.anchorPrice,
    amountIn,
    state.reserveX,
    state.reserveY,
    state.concentrationK,
    false,
  );

  if (cQ48 === 0n) return linearYToX(state, amountIn, feeMultiplier);
  if (cQ48 >= Q48) return zero;

  const upper = upperBound(state.anchorPrice, cQ48);
  if (state.anchorPrice >= upper) return zero;

  const liquidity = lx(state.anchorPrice, upper, state.reserveX);
  const maxNetDy = getAmountYDelta(state.anchorPrice, upper, liquidity, false);
  if (amountIn > maxNetDy) return zero;

  const sqrtPriceNext = getNextSqrtPriceFromAmountYRoundingDown(
    state.anchorPrice,
    liquidity,
    amountIn,
  );
  const dx = getAmountXDelta(
    state.anchorPrice,
    sqrtPriceNext,
    liquidity,
    false,
  );
  const [amountOut, fee] = applyFee(dx, state.feeAskX24, feeMultiplier);

  return { amountOut, sqrtPriceNext, fee };
}
