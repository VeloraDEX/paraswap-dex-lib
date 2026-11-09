import { BI_MAX_UINT256 } from '../../bigint-constants';
import { CurveParams, QuoteResult, QuoteState } from './types';
import {
  WAD,
  checkPowLimit,
  denormalizeWad,
  denormalizeWadUp,
  divWad,
  divWadUp,
  expWad,
  fullMulDiv,
  fullMulDivUp,
  mulWad,
  mulWadUp,
  normalizeWad,
  powWad,
  sqrtWad,
  toWadSigned,
  zeroFloorSub,
} from './baseline-math';

const BTOKEN_DECIMALS = 18;
const SAFETY_THRESHOLD = 950000000000000000n; // 95%

// The safety regime: nearly all supply still parked in the pool.
function aboveSafetyThreshold(totalSupply: bigint, bTokens: bigint): boolean {
  return bTokens >= mulWad(totalSupply, SAFETY_THRESHOLD);
}

// The convexity a mature pool settles at, and the only exponent whose block-
// boundary snapshot re-derivation is computed locally (computeNextBLV). At any
// other convexity, advanceSnapshot defers to a refetch of the on-chain state.
export const TARGET_CONVEXITY = 2n * WAD;

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

// Clamp to zero, matching the on-chain unsigned accounting.
function nonNeg(x: bigint): bigint {
  return x > 0n ? x : 0n;
}

const PPM_DENOMINATOR = 1_000_000n;

// The solver stops once its result is within one part-per-million of the target.
function solverTolerance(target: bigint): bigint {
  const t = target / PPM_DENOMINATOR;
  return t > 1n ? t : 1n;
}

// The smallest bToken delta that moves the price at all (never below one wei);
// the solver's lower bound.
function solverLowerBound(p: CurveParams): bigint {
  const supplyCirc = mulWad(p.supply, p.circ);
  const convexitySupply = mulWad(p.convexityExp, p.totalSupply);
  const kFactor =
    mulWad(p.convexityExp - WAD, p.supply) +
    mulWad(p.convexityExp + WAD, p.circ);
  const blvValue = mulWad(p.blv, p.circ);
  if (p.reserves <= blvValue || convexitySupply === 0n || kFactor === 0n) {
    return 1n;
  }
  const buffer = p.reserves - blvValue;
  const min =
    fullMulDiv(supplyCirc, supplyCirc, mulWad(buffer, convexitySupply)) /
    kFactor;
  return min > 1n ? min : 1n;
}

type SwapDeltas = { userDelta: bigint; fee: bigint; invariantDelta: bigint };

// The on-chain solvers never probe past exp(SOLVER_SAFETY_MARGIN / convexity):
// CurveLib's hard cap is convexity·ln(ratio) <= 135e18, but the fee math can
// overflow well before that, so probes stay where powered <= exp(60).
const SOLVER_SAFETY_MARGIN = 60n * WAD;

// Largest buy delta (native bToken units) the solver may probe safely.
function convexitySafeMaxBuy(p: CurveParams): bigint {
  if (p.convexityExp < WAD || p.supply === 0n) return BI_MAX_UINT256;
  const r = expWad((SOLVER_SAFETY_MARGIN * WAD) / p.convexityExp);
  const denom = r + WAD;
  const a = fullMulDiv(r, p.supply, denom);
  const b = fullMulDiv(WAD, p.circ, denom);
  const maxBuyWad = a > b ? a - b : 0n;
  return denormalizeWad(maxBuyWad, BTOKEN_DECIMALS);
}

// The current marginal price: floor value plus the convexity premium.
export function computeActivePrice(params: CurveParams): bigint {
  if (params.circ === 0n) return params.blv;
  const buffer = params.reserves - mulWad(params.blv, params.circ);
  if (buffer < 0n) throw new Error('activePrice: negative buffer');
  const premiumDenominator = mulWad(params.supply, params.circ);
  if (premiumDenominator === 0n)
    throw new Error('activePrice: zero denominator');
  const premium = fullMulDiv(
    buffer,
    mulWad(params.convexityExp, params.totalSupply),
    premiumDenominator,
  );
  return params.blv + premium;
}

// Value moved by a swap of `deltaCirc` bTokens (positive = buy, negative = sell),
// all in 1e18 precision.
export function computeSwap(
  params: CurveParams,
  deltaCirc: bigint,
): SwapDeltas {
  if (params.circ === 0n) return computeZeroCircSwap(params, deltaCirc);

  const c1 = params.circ + deltaCirc;
  if (c1 < 0n) throw new Error('swap: circulation underflow');
  if (c1 === 0n) {
    // Terminal exits pay the raw BLV floor: no swap fee is applied, otherwise
    // the seller would receive below the documented floor.
    const receipt = mulWad(params.blv, params.circ);
    return {
      userDelta: receipt,
      fee: params.reserves - receipt,
      invariantDelta: params.reserves,
    };
  }

  const x1 = params.supply - deltaCirc;
  if (x1 <= 0n) throw new Error('swap: supply underflow');

  let newBuffer: bigint;
  if (x1 >= c1) {
    const ratio = divWad(x1, c1);
    checkPowLimit(ratio, params.convexityExp);
    newBuffer = fullMulDivUp(
      params.lastInvariant,
      WAD,
      powWad(ratio, params.convexityExp),
    );
  } else {
    const invRatio = deltaCirc < 0n ? divWad(c1, x1) : divWadUp(c1, x1);
    checkPowLimit(invRatio, params.convexityExp);
    newBuffer = fullMulDivUp(
      params.lastInvariant,
      powWad(invRatio, params.convexityExp),
      WAD,
    );
  }

  const priceBefore = computeActivePrice(params);
  const priceAfterDenominator = mulWad(x1, c1);
  if (priceAfterDenominator === 0n)
    throw new Error('swap: zero price denominator');
  const priceAfter =
    params.blv +
    fullMulDiv(
      newBuffer,
      mulWad(params.convexityExp, params.totalSupply),
      priceAfterDenominator,
    );
  if (priceAfter === priceBefore) throw new Error('swap: price unchanged');

  const newReserves = newBuffer + mulWadUp(params.blv, c1);
  const invariantDelta = params.reserves - newReserves;
  const fee = computeFee(params, deltaCirc, newBuffer, invariantDelta);
  return { userDelta: invariantDelta - fee, fee, invariantDelta };
}

// First buy out of an empty pool.
function computeZeroCircSwap(
  params: CurveParams,
  deltaCirc: bigint,
): SwapDeltas {
  if (deltaCirc <= 0n) throw new Error('swap: empty pool sell');
  const x1 = params.supply - deltaCirc;
  if (x1 <= 0n) throw new Error('swap: supply underflow');

  let newBuffer: bigint;
  if (deltaCirc >= x1) {
    const ratio = divWadUp(deltaCirc, x1);
    checkPowLimit(ratio, params.convexityExp);
    newBuffer = fullMulDivUp(
      params.lastInvariant,
      powWad(ratio, params.convexityExp),
      WAD,
    );
  } else {
    const invRatio = divWad(x1, deltaCirc);
    checkPowLimit(invRatio, params.convexityExp);
    newBuffer = fullMulDivUp(
      params.lastInvariant,
      WAD,
      powWad(invRatio, params.convexityExp),
    );
  }

  const invariantDelta =
    params.reserves - (newBuffer + mulWadUp(params.blv, deltaCirc));
  const bufferReservesDenominator = mulWad(deltaCirc, x1);
  if (bufferReservesDenominator === 0n)
    throw new Error('swap: zero buffer denominator');
  const bufferReserves = fullMulDivUp(
    newBuffer,
    mulWadUp(params.convexityExp, params.totalSupply),
    bufferReservesDenominator,
  );
  const payment = mulWadUp(
    deltaCirc,
    mulWadUp(params.blv, WAD + params.swapFee * 2n) + bufferReserves,
  );
  return {
    userDelta: -payment,
    fee: invariantDelta + payment,
    invariantDelta,
  };
}

// Protocol fee: the gap between marginal and average execution.
function computeFee(
  params: CurveParams,
  deltaCirc: bigint,
  newBuffer: bigint,
  invariantDelta: bigint,
): bigint {
  const absDelta = abs(deltaCirc);
  const c1 = params.circ + deltaCirc;
  const x1 = params.supply - deltaCirc;

  if (deltaCirc > 0n) {
    const marginalPremium = fullMulDivUp(
      newBuffer,
      mulWadUp(params.convexityExp, params.totalSupply),
      mulWad(c1, x1),
    );
    const marginalCost = mulWadUp(
      absDelta,
      mulWadUp(params.blv, WAD + params.swapFee * 2n) + marginalPremium,
    );
    return zeroFloorSub(marginalCost, abs(invariantDelta));
  }

  const marginalPremium = fullMulDiv(
    newBuffer,
    mulWad(params.convexityExp, params.totalSupply),
    mulWadUp(c1, x1),
  );
  const marginalReceipt = mulWad(
    absDelta,
    params.blv + mulWad(marginalPremium, WAD - params.swapFee * 2n),
  );
  return zeroFloorSub(invariantDelta, marginalReceipt);
}

// Cumulative value moved from the snapshot to `cumulativeDeltaCircNative`.
function quoteCumulativeFromSnapshot(
  state: QuoteState,
  cumulativeDeltaCircNative: bigint,
): { userDeltaWad: bigint; invariantDeltaWad: bigint } {
  if (cumulativeDeltaCircNative === 0n)
    return { userDeltaWad: 0n, invariantDeltaWad: 0n };
  const deltaCircWad = toWadSigned(cumulativeDeltaCircNative, BTOKEN_DECIMALS);
  const { userDelta, invariantDelta } = computeSwap(
    state.snapshotCurveParams,
    deltaCircWad,
  );
  return { userDeltaWad: userDelta, invariantDeltaWad: invariantDelta };
}

// A single swap priced against the frozen snapshot plus same-block flow.
function quoteSwap(
  state: QuoteState,
  deltaCircNative: bigint,
): { deltaUserReserves: bigint; fees: bigint } {
  if (deltaCircNative < 0n && abs(deltaCircNative) > state.maxSellDelta) {
    throw new Error('quoteSwap: sell exceeds capacity');
  }

  let lower: bigint;
  let upper: bigint;
  if (deltaCircNative > 0n) {
    lower = state.quoteBlockBuyDeltaCirc;
    upper = lower + deltaCircNative;
  } else {
    lower = -state.quoteBlockSellDeltaCirc;
    upper = -(state.quoteBlockSellDeltaCirc + abs(deltaCircNative));
  }

  const before = quoteCumulativeFromSnapshot(state, lower);
  const after = quoteCumulativeFromSnapshot(state, upper);

  let deltaUserWad = after.userDeltaWad - before.userDeltaWad;
  const deltaInvariantWad = after.invariantDeltaWad - before.invariantDeltaWad;
  if (deltaUserWad > deltaInvariantWad) deltaUserWad = deltaInvariantWad;

  deltaUserWad = applySellFloor(
    state,
    lower,
    upper,
    deltaUserWad,
    deltaInvariantWad,
  );
  ensureDeltaDirection(lower, upper, deltaUserWad, deltaInvariantWad);

  if (deltaUserWad < 0n) {
    const userPay = denormalizeWadUp(abs(deltaUserWad), state.reserveDecimals);
    const curveNeed = denormalizeWadUp(
      abs(deltaInvariantWad),
      state.reserveDecimals,
    );
    return { deltaUserReserves: -userPay, fees: userPay - curveNeed };
  }

  const userReceive = denormalizeWad(deltaUserWad, state.reserveDecimals);
  const curveRelease = denormalizeWad(deltaInvariantWad, state.reserveDecimals);
  return { deltaUserReserves: userReceive, fees: curveRelease - userReceive };
}

// Every sell slice pays at least BLV per bToken, with the extra taken from the
// fee portion; if the floor exceeds what the curve released for the slice, the
// chain reverts the quote and so do we.
function applySellFloor(
  state: QuoteState,
  beforeDeltaCirc: bigint,
  afterDeltaCirc: bigint,
  deltaUserWad: bigint,
  deltaInvariantWad: bigint,
): bigint {
  // The floor only applies to sells (after < before).
  if (afterDeltaCirc >= beforeDeltaCirc) return deltaUserWad;

  const sellAmountWad = normalizeWad(
    beforeDeltaCirc - afterDeltaCirc,
    BTOKEN_DECIMALS,
  );
  const floorReceiptWad = mulWad(state.snapshotCurveParams.blv, sellAmountWad);
  if (deltaUserWad >= floorReceiptWad) return deltaUserWad;

  const floorReceiptNative = denormalizeWad(
    floorReceiptWad,
    state.reserveDecimals,
  );
  const curveReleaseNative =
    deltaInvariantWad > 0n
      ? denormalizeWad(deltaInvariantWad, state.reserveDecimals)
      : 0n;
  if (floorReceiptNative > curveReleaseNative) {
    throw new Error('quoteSwap: sell floor exceeds curve release');
  }
  return floorReceiptWad;
}

// A buy slice must move reserves toward the pool and a sell slice away from it;
// degenerate slices (quantized to the wrong sign) are refused, as on-chain.
function ensureDeltaDirection(
  beforeDeltaCirc: bigint,
  afterDeltaCirc: bigint,
  deltaUserWad: bigint,
  deltaInvariantWad: bigint,
): void {
  if (afterDeltaCirc > beforeDeltaCirc) {
    if (deltaUserWad >= 0n || deltaInvariantWad >= 0n) {
      throw new Error('quoteSwap: invalid buy delta direction');
    }
  } else if (afterDeltaCirc < beforeDeltaCirc) {
    if (deltaUserWad < 0n || deltaInvariantWad < 0n) {
      throw new Error('quoteSwap: invalid sell delta direction');
    }
  }
}

// Largest buy whose reserve cost does not exceed `target`.
function solveBuy(
  state: QuoteState,
  target: bigint,
): { delta: bigint; accountingFee: bigint } {
  const p = state.snapshotCurveParams;
  const priceWithFee = mulWad(computeActivePrice(p), WAD + p.swapFee * 2n);
  if (priceWithFee === 0n) throw new Error('solveBuy: zero price');

  const estimated = denormalizeWad(
    divWad(normalizeWad(target, state.reserveDecimals), priceWithFee) * 2n,
    BTOKEN_DECIMALS,
  );
  const inventoryMax = (state.totalBTokens * 99n) / 100n;
  const convexMax = convexitySafeMaxBuy(p);
  const maxDelta = inventoryMax < convexMax ? inventoryMax : convexMax;
  if (maxDelta <= 0n) throw new Error('solveBuy: no capacity');

  let hi = estimated < 2n ? 2n : estimated;
  if (hi > maxDelta) hi = maxDelta;
  while (hi < maxDelta) {
    const cost = buyCost(state, hi);
    if (cost !== null && cost <= target) {
      hi = hi * 2n > maxDelta ? maxDelta : hi * 2n;
      continue;
    }
    break;
  }

  const lo = solverLowerBound(p);
  // In floor-regime pools the lower bound can exceed every safe upper bound;
  // the bisection below would then be skipped and delta = lo would escape the
  // inventory/convexity caps entirely.
  if (lo > hi) throw new Error('solveBuy: no capacity');
  const tolerance = solverTolerance(target);
  let delta = lo;

  // When the entire capacity is affordable and further from the target than
  // the ppm tolerance, every bisection probe succeeds without triggering the
  // early break (cost is monotone in delta), deterministically converging on
  // hi - 1; skip the ~80 redundant powWad probes and go straight there.
  const costAtCapacity = hi === maxDelta && hi > lo ? buyCost(state, hi) : null;
  if (
    costAtCapacity !== null &&
    costAtCapacity <= target &&
    target - costAtCapacity > tolerance
  ) {
    delta = hi - 1n;
  } else {
    let lower = lo;
    while (hi - lower > 1n) {
      const mid = (lower + hi) / 2n;
      const cost = buyCost(state, mid);
      if (cost !== null && cost <= target) {
        lower = mid;
        delta = mid;
        if (target - cost <= tolerance) break;
      } else {
        hi = mid;
      }
    }
  }

  const { deltaUserReserves, fees } = quoteSwap(state, delta);
  const cost = abs(deltaUserReserves);
  if (cost === 0n || cost > target) throw new Error('solveBuy: no fit');
  return { delta, accountingFee: fees };
}

function buyCost(state: QuoteState, delta: bigint): bigint | null {
  try {
    return abs(quoteSwap(state, delta).deltaUserReserves);
  } catch {
    return null;
  }
}

// Sell exact bTokens in, receive reserves out.
export function quoteSellExactIn(
  state: QuoteState,
  tokensIn: bigint,
): QuoteResult {
  if (tokensIn <= 0n) throw new Error('sellExactIn: non-positive');
  const { deltaUserReserves, fees } = quoteSwap(state, -tokensIn);
  if (deltaUserReserves <= 0n) throw new Error('sellExactIn: no rate');
  return { amount: deltaUserReserves, fee: fees };
}

// Spend exact reserves in, receive bTokens out.
export function quoteBuyExactIn(
  state: QuoteState,
  reservesIn: bigint,
): QuoteResult {
  if (reservesIn <= 0n) throw new Error('buyExactIn: non-positive');
  const { delta, accountingFee } = solveBuy(state, reservesIn);
  if (delta <= 0n) throw new Error('buyExactIn: no rate');
  return { amount: delta, fee: accountingFee };
}

// Buy exact bTokens out, pay reserves in.
export function quoteBuyExactOut(
  state: QuoteState,
  tokensOut: bigint,
): QuoteResult {
  if (tokensOut <= 0n) throw new Error('buyExactOut: non-positive');
  const { deltaUserReserves, fees } = quoteSwap(state, tokensOut);
  const cost = abs(deltaUserReserves);
  if (cost <= 0n) throw new Error('buyExactOut: no rate');
  return { amount: cost, fee: fees };
}

// Advance the state by an executed swap: settle surplus, move totals, accrue fees.
export function applyQuoteState(
  state: QuoteState,
  deltaCirc: bigint,
  reserveDelta: bigint,
  fee: bigint,
): void {
  settlePendingSurplus(state);

  const nextTotalBTokens = state.totalBTokens - deltaCirc;
  state.totalBTokens = nonNeg(nextTotalBTokens);
  state.totalReserves = nonNeg(state.totalReserves - reserveDelta - fee);
  recordPendingLiquidityFee(state, nextTotalBTokens, fee);

  if (deltaCirc > 0n) state.quoteBlockBuyDeltaCirc += deltaCirc;
  else if (deltaCirc < 0n) state.quoteBlockSellDeltaCirc += abs(deltaCirc);
  state.maxSellDelta = nonNeg(state.maxSellDelta - abs(deltaCirc));
}

function settlePendingSurplus(state: QuoteState): void {
  const settle = state.settlePendingSurplus && state.pendingSurplus !== 0n;
  state.settlePendingSurplus = false;
  if (!settle) return;
  if (!aboveSafetyThreshold(state.totalSupply, state.totalBTokens)) {
    state.totalReserves += state.pendingSurplus;
  }
  state.pendingSurplus = 0n;
}

function recordPendingLiquidityFee(
  state: QuoteState,
  nextTotalBTokens: bigint,
  fee: bigint,
): void {
  if (fee <= 0n) return;
  if (aboveSafetyThreshold(state.totalSupply, nextTotalBTokens)) return;
  const liquidityFee = mulWad(fee, state.liquidityFeePct);
  if (liquidityFee > 0n) state.pendingSurplus += liquidityFee;
}

// The curve invariant K at the given state.
export function computeInvariant(params: CurveParams): bigint {
  if (params.circ === 0n) return params.lastInvariant;
  const buffer = params.reserves - mulWad(params.blv, params.circ);
  if (params.supply >= params.circ) {
    const ratio = divWadUp(params.supply, params.circ);
    return mulWadUp(buffer, powWad(ratio, params.convexityExp));
  }
  const invRatio = divWad(params.circ, params.supply);
  return divWadUp(buffer, powWad(invRatio, params.convexityExp));
}

// The floor value (BLV) for the next block, ratcheted up as the pool grows.
// Defined only at TARGET_CONVEXITY.
function computeNextBLV(
  params: CurveParams,
  prevSupply: bigint,
  prevReserves: bigint,
): bigint {
  const prevCirc = params.totalSupply - prevSupply;
  if (prevCirc === 0n) return params.blv;

  const penaltyNumer = fullMulDivUp(
    fullMulDivUp(prevSupply, prevSupply, WAD),
    params.circ,
    WAD,
  );
  const supplyPrevCirc = fullMulDiv(params.supply, prevCirc, WAD);
  const penaltyDenom = fullMulDiv(supplyPrevCirc, supplyPrevCirc, WAD);
  if (penaltyDenom === 0n) return params.blv;

  const penalty = fullMulDivUp(
    prevReserves - mulWadUp(params.blv, params.totalSupply - prevSupply),
    penaltyNumer,
    penaltyDenom,
  );
  const bookPrice = divWad(params.reserves, params.circ);
  const maxBLV = bookPrice > penalty ? bookPrice - penalty : 0n;
  const targetBLV = divWad(
    mulWad(params.reserves, sqrtWad(params.totalSupply)),
    mulWad(params.circ, sqrtWad(params.circ) + sqrtWad(params.totalSupply)),
  );
  const capped = maxBLV < targetBLV ? maxBLV : targetBLV;
  return capped > params.blv ? capped : params.blv;
}

// Re-derive the frozen snapshot at a block boundary from the state committed by
// the previous block's trades, and clear the in-block accumulators. Returns null
// when the boundary needs data we do not hold locally (the safety regime or a
// relaxing convexity), signalling the caller to refetch instead.
export function advanceSnapshot(state: QuoteState): QuoteState | null {
  const hasPending =
    state.quoteBlockBuyDeltaCirc !== 0n || state.quoteBlockSellDeltaCirc !== 0n;
  if (!hasPending) return state;

  const snap = state.snapshotCurveParams;
  const inSafety = aboveSafetyThreshold(state.totalSupply, state.totalBTokens);
  if (inSafety || snap.convexityExp !== TARGET_CONVEXITY) return null;

  // Below safety, retained liquidity fees are committed into the reserve at the
  // boundary: they back the curve and reset to zero, and the fresh snapshot is
  // re-derived from that committed reserve.
  const committedReserves = state.totalReserves + state.pendingSurplus;
  const committed: CurveParams = {
    blv: snap.blv,
    convexityExp: snap.convexityExp,
    swapFee: snap.swapFee,
    totalSupply: snap.totalSupply,
    reserves: normalizeWad(committedReserves, state.reserveDecimals),
    supply: state.totalBTokens,
    circ: state.totalSupply - state.totalBTokens,
    lastInvariant: snap.lastInvariant,
  };
  const nextBlv = computeNextBLV(committed, snap.supply, snap.reserves);
  const nextSnapshot: CurveParams = {
    ...committed,
    blv: nextBlv,
    lastInvariant: computeInvariant({ ...committed, blv: nextBlv }),
  };

  return {
    ...state,
    snapshotCurveParams: nextSnapshot,
    quoteBlockBuyDeltaCirc: 0n,
    quoteBlockSellDeltaCirc: 0n,
    totalReserves: committedReserves,
    pendingSurplus: 0n,
    settlePendingSurplus: false,
    // The in-block sell headroom resets to the freshly frozen circulation.
    maxSellDelta: nextSnapshot.circ,
    snapshotActivePrice: computeActivePrice(nextSnapshot),
  };
}
