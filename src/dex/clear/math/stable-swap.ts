// Pure-TypeScript port of Curve StableSwap NG math (CurveStableSwapNG.vy + CurveStableSwapMetaNG.vy).
// Mirrors the on-chain integer arithmetic exactly so off-chain previews match `get_dy_underlying` to the wei.

export type StableSwapState = {
  balances: bigint[];
  a_initial: bigint;
  a_final: bigint;
  a_initial_time: bigint;
  a_final_time: bigint;
  fee: bigint;
  offpegFeeMultiplier: bigint;
  rates: bigint[];
  storedRates: bigint[];
  lpTotalSupply?: bigint;
};

export type MetapoolState = {
  metapool: StableSwapState;
  basePool: StableSwapState;
  basePoolVirtualPrice: bigint;
};

const A_PRECISION = 100n;
const FEE_DENOMINATOR = 10n ** 10n;
const PRECISION = 10n ** 18n;
const MAX_LOOP_LIMIT = 256;

// Linearly interpolates the amplification coefficient between a_initial and a_final, mirroring `_A()`.
export function getCurrentA(
  state: StableSwapState,
  blockTimestamp: bigint,
): bigint {
  const t1 = state.a_final_time;
  const a1 = state.a_final;
  if (blockTimestamp < t1) {
    const a0 = state.a_initial;
    const t0 = state.a_initial_time;
    if (a1 > a0) {
      return a0 + ((a1 - a0) * (blockTimestamp - t0)) / (t1 - t0);
    }
    return a0 - ((a0 - a1) * (blockTimestamp - t0)) / (t1 - t0);
  }
  return a1;
}

// Newton iteration for the StableSwap NG invariant D given balances scaled by storedRates/PRECISION.
export function getD(xp: bigint[], amp: bigint): bigint {
  const nCoins = BigInt(xp.length);
  let s = 0n;
  for (const x of xp) s += x;
  if (s === 0n) return 0n;

  let d = s;
  const ann = amp * nCoins;

  for (let i = 0; i < MAX_LOOP_LIMIT; i++) {
    let dP = d;
    for (const x of xp) {
      // Will revert (division by zero) if any balance is 0, matching on-chain behaviour.
      dP = (dP * d) / x;
    }
    dP = dP / nCoins ** nCoins;

    const dPrev = d;
    d =
      (((ann * s) / A_PRECISION + dP * nCoins) * d) /
      (((ann - A_PRECISION) * d) / A_PRECISION + (nCoins + 1n) * dP);

    if (d > dPrev) {
      if (d - dPrev <= 1n) return d;
    } else {
      if (dPrev - d <= 1n) return d;
    }
  }
  throw new Error('StableSwapNG: getD did not converge');
}

// Newton iteration solving for the new balance of coin j given coin i moves to x, using NG's A_PRECISION.
export function getY(
  i: number,
  j: number,
  x: bigint,
  xp: bigint[],
  amp: bigint,
): bigint {
  const nCoins = xp.length;
  if (i === j) throw new Error('StableSwapNG: same coin');
  if (j < 0 || j >= nCoins) throw new Error('StableSwapNG: j out of range');
  if (i < 0 || i >= nCoins) throw new Error('StableSwapNG: i out of range');

  const biN = BigInt(nCoins);
  const d = getD(xp, amp);
  const ann = amp * biN;

  let c = d;
  let s = 0n;
  let xk = 0n;
  for (let k = 0; k < nCoins; k++) {
    if (k === i) {
      xk = x;
    } else if (k !== j) {
      xk = xp[k];
    } else {
      continue;
    }
    s += xk;
    c = (c * d) / (xk * biN);
  }
  c = (c * d * A_PRECISION) / (ann * biN);
  const b = s + (d * A_PRECISION) / ann;
  // Vyper would revert on the underflow if 2y + b < d; mirror that explicitly.
  if (b < d) throw new Error('StableSwapNG: getY underflow (b < d)');

  let y = d;
  for (let k = 0; k < MAX_LOOP_LIMIT; k++) {
    const yPrev = y;
    y = (y * y + c) / (2n * y + b - d);
    if (y > yPrev) {
      if (y - yPrev <= 1n) return y;
    } else {
      if (yPrev - y <= 1n) return y;
    }
  }
  throw new Error('StableSwapNG: getY did not converge');
}

// Same Newton iteration as getY but solves for coin i given a target invariant D (used inside _calc_withdraw_one_coin).
function getYD(amp: bigint, i: number, xp: bigint[], d: bigint): bigint {
  const nCoins = xp.length;
  if (i < 0 || i >= nCoins) throw new Error('StableSwapNG: i out of range');

  const biN = BigInt(nCoins);
  const ann = amp * biN;

  let c = d;
  let s = 0n;
  let xk = 0n;
  for (let k = 0; k < nCoins; k++) {
    if (k !== i) {
      xk = xp[k];
    } else {
      continue;
    }
    s += xk;
    c = (c * d) / (xk * biN);
  }
  c = (c * d * A_PRECISION) / (ann * biN);
  const b = s + (d * A_PRECISION) / ann;

  let y = d;
  for (let k = 0; k < MAX_LOOP_LIMIT; k++) {
    const yPrev = y;
    y = (y * y + c) / (2n * y + b - d);
    if (y > yPrev) {
      if (y - yPrev <= 1n) return y;
    } else {
      if (yPrev - y <= 1n) return y;
    }
  }
  throw new Error('StableSwapNG: getYD did not converge');
}

// Computes balances scaled by storedRates / PRECISION (the NG invariant operates in this space).
function xpMem(rates: bigint[], balances: bigint[]): bigint[] {
  const out: bigint[] = new Array(balances.length);
  for (let k = 0; k < balances.length; k++) {
    out[k] = (rates[k] * balances[k]) / PRECISION;
  }
  return out;
}

// NG dynamic fee: `fee * feemul / ((feemul - 1) * 4 * xpi * xpj / (xpi + xpj)^2 + 1)`.
function dynamicFee(
  xpi: bigint,
  xpj: bigint,
  fee: bigint,
  feemul: bigint,
): bigint {
  if (feemul <= FEE_DENOMINATOR) return fee;
  let xps2 = xpi + xpj;
  xps2 = xps2 * xps2;
  return (
    (feemul * fee) /
    (((feemul - FEE_DENOMINATOR) * 4n * xpi * xpj) / xps2 + FEE_DENOMINATOR)
  );
}

// Plain-pool swap with NG dynamic-fee accounting; returns the destination amount in coin j's native units.
export function getDy(
  state: StableSwapState,
  i: number,
  j: number,
  dx: bigint,
  blockTimestamp: bigint,
): bigint {
  const rates = state.storedRates;
  const xp = xpMem(rates, state.balances);

  const amp = getCurrentA(state, blockTimestamp);
  const x = xp[i] + (dx * rates[i]) / PRECISION;
  const y = getY(i, j, x, xp, amp);
  const dy = xp[j] - y - 1n;

  const fee = dynamicFee(
    (xp[i] + x) / 2n,
    (xp[j] + y) / 2n,
    state.fee,
    state.offpegFeeMultiplier,
  );
  const feeAmt = (fee * dy) / FEE_DENOMINATOR;
  return ((dy - feeAmt) * PRECISION) / rates[j];
}

// NG `_calc_withdraw_one_coin`: imbalanced single-sided withdraw from the base pool, in coin i's native units.
function calcWithdrawOneCoin(
  state: StableSwapState,
  tokenAmount: bigint,
  i: number,
  blockTimestamp: bigint,
): bigint {
  if (state.lpTotalSupply === undefined) {
    throw new Error('StableSwapNG: lpTotalSupply is required for base pool');
  }
  const amp = getCurrentA(state, blockTimestamp);
  const rates = state.storedRates;
  const xp = xpMem(rates, state.balances);

  const d0 = getD(xp, amp);
  const totalSupply = state.lpTotalSupply;
  const d1 = d0 - (tokenAmount * d0) / totalSupply;
  const newY = getYD(amp, i, xp, d1);

  const nCoins = xp.length;
  const biN = BigInt(nCoins);
  const baseFee = (state.fee * biN) / (4n * (biN - 1n));
  const feemul = state.offpegFeeMultiplier;
  const ys = (d0 + d1) / (2n * biN);

  const xpReduced: bigint[] = new Array(nCoins);
  for (let j = 0; j < nCoins; j++) {
    let dxExpected = 0n;
    let xavg = 0n;
    if (j === i) {
      dxExpected = (xp[j] * d1) / d0 - newY;
      xavg = (xp[j] + newY) / 2n;
    } else {
      dxExpected = xp[j] - (xp[j] * d1) / d0;
      xavg = xp[j];
    }
    const dynFee = dynamicFee(xavg, ys, baseFee, feemul);
    xpReduced[j] = xp[j] - (dynFee * dxExpected) / FEE_DENOMINATOR;
  }

  let dy = xpReduced[i] - getYD(amp, i, xpReduced, d1);
  dy = ((dy - 1n) * PRECISION) / rates[i];
  return dy;
}

// NG `calc_token_amount(deposit=True)` approximation used inside `_meta_add_liquidity` to value an underlying deposit as LP shares.
function calcTokenAmountDeposit(
  state: StableSwapState,
  amounts: bigint[],
  blockTimestamp: bigint,
): bigint {
  if (state.lpTotalSupply === undefined) {
    throw new Error('StableSwapNG: lpTotalSupply is required for base pool');
  }
  const amp = getCurrentA(state, blockTimestamp);
  const rates = state.storedRates;
  const balances = state.balances;
  const nCoins = balances.length;

  const xp0 = xpMem(rates, balances);
  const d0 = getD(xp0, amp);

  const newBalances: bigint[] = new Array(nCoins);
  for (let k = 0; k < nCoins; k++) {
    newBalances[k] = balances[k] + amounts[k];
  }
  const xp1 = xpMem(rates, newBalances);
  const d1 = getD(xp1, amp);

  // NG without imbalance fee (preview before imbalance penalty); _meta_add_liquidity halves the base pool fee separately.
  const diff = d1 > d0 ? d1 - d0 : d0 - d1;
  return (state.lpTotalSupply * diff) / d0;
}

// Mirrors `_get_dy_underlying`: i=0 is the metapool IOU, j>=1 indexes the base pool's underlying coins.
export function getDyUnderlying(
  state: MetapoolState,
  i: number,
  j: number,
  dx: bigint,
  blockTimestamp: bigint,
): bigint {
  const meta = state.metapool;
  const base = state.basePool;
  const baseN = base.balances.length;
  const MAX_COIN = 1; // Metapool always pairs IOU (idx 0) with base LP (idx 1).

  if (i === j) throw new Error('StableSwapNG: same coin');
  if (i < 0 || j < 0) throw new Error('StableSwapNG: negative index');
  if (i > baseN || j > baseN) throw new Error('StableSwapNG: index too high');

  // Build the metapool's stored rates: [iou_rate, base_pool_virtual_price].
  const metaRates: bigint[] = [meta.storedRates[0], state.basePoolVirtualPrice];
  const xp = xpMem(metaRates, meta.balances);

  let baseI = 0;
  let baseJ = 0;
  let metaI = 0;
  let metaJ = 0;
  if (i !== 0) {
    baseI = i - MAX_COIN;
    metaI = 1;
  }
  if (j !== 0) {
    baseJ = j - MAX_COIN;
    metaJ = 1;
  }

  let x = 0n;
  if (i === 0) {
    x = xp[i] + (dx * metaRates[0]) / PRECISION;
  } else {
    if (j !== 0) {
      // Pure base-pool swap: bypass the metapool entirely.
      return getDy(base, baseI, baseJ, dx, blockTimestamp);
    }
    // Underlying -> IOU: deposit into base pool to value as LP, then swap LP -> IOU on metapool.
    const baseInputs: bigint[] = new Array(baseN).fill(0n);
    baseInputs[baseI] = dx;
    x =
      (calcTokenAmountDeposit(base, baseInputs, blockTimestamp) *
        metaRates[1]) /
      PRECISION;
    // Approximate accounting for the deposit fee (matches metapool source).
    x -= (x * base.fee) / (2n * FEE_DENOMINATOR);
    x += xp[MAX_COIN];
  }

  const amp = getCurrentA(meta, blockTimestamp);
  const y = getY(metaI, metaJ, x, xp, amp);
  let dy = xp[metaJ] - y - 1n;
  const fee = dynamicFee(
    (xp[metaI] + x) / 2n,
    (xp[metaJ] + y) / 2n,
    meta.fee,
    meta.offpegFeeMultiplier,
  );
  dy = dy - (fee * dy) / FEE_DENOMINATOR;

  if (j === 0) {
    // Result is in IOU's native units.
    dy = (dy * PRECISION) / metaRates[0];
  } else {
    // Withdraw the corresponding base-pool coin; convert metapool LP units back into LP token amount first.
    const lpAmount = (dy * PRECISION) / metaRates[1];
    dy = calcWithdrawOneCoin(base, lpAmount, baseJ, blockTimestamp);
  }

  return dy;
}
