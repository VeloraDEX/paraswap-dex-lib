// Port of the on-chain LunarBase pool quote math (dark_pools SwapLib).
//
// Two pricing models are deployed:
//  - punishment model (current): linear anchor price, the stored directional
//    fee is raised by a size-proportional punishment for the current swap;
//  - concentration model (legacy): a concentrated curve around the anchor
//    whose width depends on the swap size relative to the inventory.
// Every helper mirrors the Solidity rounding of the corresponding contract
// function, so quotes match `quoteXToY` / `quoteYToX` to the wei.
import { LunarBasePoolState, LunarBaseQuoteResult } from './types';

const Q12 = 1n << 12n;
const Q24 = 1n << 24n;
const Q48 = 1n << 48n;
const Q96 = 1n << 96n;
const MAX_U24 = (1n << 24n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;
const MAX_U160 = (1n << 160n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

// A Solidity revert in the mirrored path (overflow, SafeCast). The swap would
// revert too, so the quote is treated as unavailable.
export class LunarBaseMathError extends Error {}

function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new LunarBaseMathError('mulDiv: division by zero');
  const r = (a * b) / d;
  if (r > MAX_U256) throw new LunarBaseMathError('mulDiv: overflow');
  return r;
}

function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new LunarBaseMathError('mulDivUp: division by zero');
  const p = a * b;
  let r = p / d;
  if (p % d !== 0n) r += 1n;
  if (r > MAX_U256) throw new LunarBaseMathError('mulDivUp: overflow');
  return r;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new LunarBaseMathError('ceilDiv: division by zero');
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

function isqrt(x: bigint): bigint {
  if (x < 2n) return x;
  // Newton iteration from an upper bound; exact floor(sqrt(x)).
  let r = 1n << (BigInt(x.toString(2).length + 1) / 2n);
  for (;;) {
    const next = (r + x / r) >> 1n;
    if (next >= r) return r;
    r = next;
  }
}

function toUint160(x: bigint): bigint {
  if (x > MAX_U160) throw new LunarBaseMathError('SafeCast: uint160');
  return x;
}

function toUint128(x: bigint): bigint {
  if (x > MAX_U128) throw new LunarBaseMathError('SafeCast: uint128');
  return x;
}

const rejected = (anchorPrice: bigint): LunarBaseQuoteResult => ({
  amountOut: 0n,
  sqrtPriceNext: anchorPrice,
  fee: 0n,
});

// SwapLib._xValueInY: X valued in Y at the squared Q64.96 anchor, two floors.
function xValueInY(amountX: bigint, anchorPrice: bigint): bigint {
  return mulDiv(mulDiv(amountX, anchorPrice, Q96), anchorPrice, Q96);
}

function yValueInX(amountY: bigint, anchorPrice: bigint): bigint {
  return mulDiv(mulDiv(amountY, Q96, anchorPrice), Q96, anchorPrice);
}

// SwapLib.applyFee. The MEV tax that the current impl adds when the tx
// priority fee is above the pool threshold is not modelled: it depends on the
// gas price of the user's transaction, which is unknown at pricing time.
function applyFee(
  grossOutput: bigint,
  feeQ24: bigint,
  feeMultiplier: bigint,
  saturatesAtMax: boolean,
): { amountOut: bigint; fee: bigint } {
  if (saturatesAtMax && feeQ24 === MAX_U24) {
    return { amountOut: 0n, fee: grossOutput };
  }
  let fee = mulDiv(grossOutput, feeQ24, Q24);
  if (fee === 0n || feeMultiplier <= 1n) {
    return { amountOut: grossOutput - fee, fee };
  }
  if (feeMultiplier > MAX_U256 / fee) {
    return { amountOut: 0n, fee: grossOutput };
  }
  fee *= feeMultiplier;
  if (fee >= grossOutput) return { amountOut: 0n, fee: grossOutput };
  return { amountOut: grossOutput - fee, fee };
}

// ---------------------------------------------------------------------------
// Punishment model
// ---------------------------------------------------------------------------

export function punishmentX24(
  state: LunarBasePoolState,
  amountIn: bigint,
  xToY: boolean,
): bigint {
  const maxPunishment = BigInt(state.maxPunishmentX24);
  if (amountIn === 0n || maxPunishment === 0n || state.anchorPrice === 0n) {
    return 0n;
  }

  const inventoryWealth =
    xValueInY(state.reserveX, state.anchorPrice) + state.reserveY;
  if (inventoryWealth === 0n) return 0n;

  const swapWealth = xToY ? xValueInY(amountIn, state.anchorPrice) : amountIn;
  if (swapWealth === 0n) return 0n;

  const maximum = maxPunishment === MAX_U24 ? Q24 : maxPunishment;
  const calculated =
    swapWealth >= inventoryWealth
      ? maximum
      : mulDivUp(maximum, swapWealth, inventoryWealth);

  return calculated >= Q24 ? MAX_U24 : calculated;
}

// SwapLib.saturatingFeeX24: the fee used by this swap and stored after it.
export function saturatingFeeX24(storedFeeX24: bigint, desired: bigint) {
  const available = MAX_U24 - storedFeeX24;
  return desired >= available ? MAX_U24 : storedFeeX24 + desired;
}

function punishmentQuoteXToY(
  state: LunarBasePoolState,
  dx: bigint,
  feeMultiplier: bigint,
): LunarBaseQuoteResult {
  const effectiveFee = saturatingFeeX24(
    BigInt(state.feeBidX24),
    punishmentX24(state, dx, true),
  );
  const dy = xValueInY(dx, state.anchorPrice);
  if (dy === 0n || dy > state.reserveY) return rejected(state.anchorPrice);
  return {
    ...applyFee(dy, effectiveFee, feeMultiplier, true),
    sqrtPriceNext: state.anchorPrice,
  };
}

function punishmentQuoteYToX(
  state: LunarBasePoolState,
  dy: bigint,
  feeMultiplier: bigint,
): LunarBaseQuoteResult {
  const effectiveFee = saturatingFeeX24(
    BigInt(state.feeAskX24),
    punishmentX24(state, dy, false),
  );
  if (state.anchorPrice === 0n) return rejected(state.anchorPrice);
  const dx = yValueInX(dy, state.anchorPrice);
  if (dx === 0n || dx > state.reserveX) return rejected(state.anchorPrice);
  return {
    ...applyFee(dx, effectiveFee, feeMultiplier, true),
    sqrtPriceNext: state.anchorPrice,
  };
}

// ---------------------------------------------------------------------------
// Concentration model (legacy pools)
// ---------------------------------------------------------------------------

function concentrationQ48(
  state: LunarBasePoolState,
  amountIn: bigint,
  xToY: boolean,
): bigint {
  const k = BigInt(state.concentrationK);
  const p = state.anchorPrice;
  if (amountIn === 0n || k === 0n || p === 0n) return 0n;

  const totalWealthInY = xValueInY(state.reserveX, p) + state.reserveY;
  if (totalWealthInY === 0n) return 0n;

  const amountInWealth = xToY ? xValueInY(amountIn, p) : amountIn;
  const rQ48 =
    amountInWealth >= totalWealthInY
      ? Q48
      : mulDiv(amountInWealth, Q48, totalWealthInY);
  const rSquaredQ48 = mulDiv(rQ48, rQ48, Q48);
  const cQ48 = mulDiv(k, rSquaredQ48, Q12);
  return cQ48 >= Q48 ? Q48 : cQ48;
}

function lowerBound(p: bigint, cQ48: bigint): bigint {
  return toUint160(mulDiv(p, isqrt(Q48 - cQ48), Q24));
}

function upperBound(p: bigint, cQ48: bigint): bigint {
  return toUint160(mulDiv(p, Q24, isqrt(Q48 - cQ48)));
}

function liquidityY(p: bigint, lower: bigint, reserveY: bigint): bigint {
  return toUint128(mulDiv(reserveY, Q96, p - lower));
}

function liquidityX(p: bigint, upper: bigint, reserveX: bigint): bigint {
  const priceProductX96 = mulDiv(p, upper, Q96);
  return toUint128(mulDiv(reserveX, priceProductX96, upper - p));
}

function getAmountXDelta(a: bigint, b: bigint, liquidity: bigint): bigint {
  if (a > b) [a, b] = [b, a];
  if (a === 0n) throw new LunarBaseMathError('InvalidSqrtRatioAX96');
  return mulDiv(liquidity << 96n, b - a, b) / a;
}

function getAmountYDelta(a: bigint, b: bigint, liquidity: bigint): bigint {
  if (a > b) [a, b] = [b, a];
  return mulDiv(liquidity, b - a, Q96);
}

// SqrtPriceMath.getNextSqrtPriceFromAmountXRoundingUp(addX = true), with the
// unchecked uint256 product of the contract.
function nextSqrtPriceFromAmountX(
  p: bigint,
  liquidity: bigint,
  amountX: bigint,
): bigint {
  if (amountX === 0n) return p;
  const numerator1 = liquidity << 96n;
  const product = (amountX * p) & MAX_U256;
  if (product / amountX === p) {
    const denominator = numerator1 + product;
    if (denominator <= MAX_U256) {
      return toUint160(mulDivUp(numerator1, p, denominator));
    }
  }
  return toUint160(ceilDiv(numerator1, numerator1 / p + amountX));
}

// SqrtPriceMath.getNextSqrtPriceFromAmountYRoundingDown(addY = true).
function nextSqrtPriceFromAmountY(
  p: bigint,
  liquidity: bigint,
  amountY: bigint,
): bigint {
  const quotient =
    amountY <= MAX_U160
      ? (amountY << 96n) / liquidity
      : mulDiv(amountY, Q96, liquidity);
  return toUint160(p + quotient);
}

function concentrationQuoteXToY(
  state: LunarBasePoolState,
  dx: bigint,
  feeMultiplier: bigint,
): LunarBaseQuoteResult {
  const p = state.anchorPrice;
  const fee = BigInt(state.feeBidX24);
  const cQ48 = concentrationQ48(state, dx, true);
  if (cQ48 === 0n) {
    const dy = xValueInY(dx, p);
    if (dy === 0n || dy > state.reserveY) return rejected(p);
    return { ...applyFee(dy, fee, feeMultiplier, false), sqrtPriceNext: p };
  }
  if (cQ48 >= Q48) return rejected(p);

  const lower = lowerBound(p, cQ48);
  if (p <= lower) return rejected(p);
  const liquidity = liquidityY(p, lower, state.reserveY);
  if (liquidity === 0n) throw new LunarBaseMathError('LiquidityIsZero');
  if (dx > getAmountXDelta(lower, p, liquidity)) return rejected(p);

  const pNext = nextSqrtPriceFromAmountX(p, liquidity, dx);
  const dy = getAmountYDelta(p, pNext, liquidity);
  return {
    ...applyFee(dy, fee, feeMultiplier, false),
    sqrtPriceNext: pNext,
  };
}

function concentrationQuoteYToX(
  state: LunarBasePoolState,
  dy: bigint,
  feeMultiplier: bigint,
): LunarBaseQuoteResult {
  const p = state.anchorPrice;
  const fee = BigInt(state.feeAskX24);
  const cQ48 = concentrationQ48(state, dy, false);
  if (cQ48 === 0n) {
    if (p === 0n) return rejected(p);
    const dx = yValueInX(dy, p);
    if (dx === 0n || dx > state.reserveX) return rejected(p);
    return { ...applyFee(dx, fee, feeMultiplier, false), sqrtPriceNext: p };
  }
  if (cQ48 >= Q48) return rejected(p);

  const upper = upperBound(p, cQ48);
  if (p >= upper) return rejected(p);
  const liquidity = liquidityX(p, upper, state.reserveX);
  if (liquidity === 0n) throw new LunarBaseMathError('LiquidityIsZero');
  if (dy > getAmountYDelta(p, upper, liquidity)) return rejected(p);

  const pNext = nextSqrtPriceFromAmountY(p, liquidity, dy);
  const dx = getAmountXDelta(p, pNext, liquidity);
  return {
    ...applyFee(dx, fee, feeMultiplier, false),
    sqrtPriceNext: pNext,
  };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function quoteXToY(
  state: LunarBasePoolState,
  dx: bigint,
  feeMultiplier = 1n,
): LunarBaseQuoteResult {
  try {
    return state.model === 'punishment'
      ? punishmentQuoteXToY(state, dx, feeMultiplier)
      : concentrationQuoteXToY(state, dx, feeMultiplier);
  } catch (e) {
    if (e instanceof LunarBaseMathError) return rejected(state.anchorPrice);
    throw e;
  }
}

export function quoteYToX(
  state: LunarBasePoolState,
  dy: bigint,
  feeMultiplier = 1n,
): LunarBaseQuoteResult {
  try {
    return state.model === 'punishment'
      ? punishmentQuoteYToX(state, dy, feeMultiplier)
      : concentrationQuoteYToX(state, dy, feeMultiplier);
  } catch (e) {
    if (e instanceof LunarBaseMathError) return rejected(state.anchorPrice);
    throw e;
  }
}
