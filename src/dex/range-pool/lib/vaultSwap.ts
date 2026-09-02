/**
 * Vault-level swap-flow emulation for Range Pools — the bit-exact wrapper around `RangeMath`
 * that the Vault applies on every swap. Ports `Vault._swap` + `_computeAmountGivenScaled18` +
 * `ScalingHelpers` from `balancer-v3-monorepo/pkg/vault`, restricted to token↔token swaps.
 *
 * Flow per side (raw token units in, raw token units out):
 *   EXACT_IN (SwapSide.SELL):
 *     scaled18 = scaleDown(amountInRaw)           // toScaled18ApplyRateRoundDown
 *     fee      = scaled18.mulUp(swapFee)           // deducted from the input
 *     out18    = RangeMath.calcOutGivenIn(..., scaled18 - fee, factOut)   // fact-capped
 *     return     unscaleDown(out18)                // toRawUndoRateRoundDown
 *   EXACT_OUT (SwapSide.BUY):
 *     out18    = scaleUp(amountOutRaw)             // toScaled18ApplyRateRoundUp
 *     guard      isExactOutAllowed(out18, factOut, vbOut)  // else the Vault reverts -> no price
 *     in18     = RangeMath.calcInGivenOut(..., out18)
 *     fee      = in18.mulDivUp(swapFee, 1 - swapFee)        // added on top of the input
 *     return     unscaleUp(in18 + fee)             // toRawUndoRateRoundUp
 *
 * Verified to equal `Router.querySwapSingleTokenExactIn/Out` to the wei on a mainnet fork
 * (range-pool-integration.test.ts). Rounding directions mirror Solidity exactly.
 */

import { PoolState } from '../types';
import { complement, mulDown, mulUp, divDown, divUp, WAD } from './fixedPoint';
import { calcInGivenOut, calcOutGivenIn, isExactOutAllowed } from './rangeMath';

// ScalingHelpers.computeRateRoundUp: round the rate up to the next WAD multiple only if it
// isn't already an exact multiple of WAD. For Range tokens the rate is 1e18, so this is a no-op.
export function computeRateRoundUp(rate: bigint): bigint {
  const rounded = (rate / WAD) * WAD;
  return rounded === rate ? rate : rounded + WAD;
}

// scaled18 = (raw * scalingFactor) * rate / 1e18, rounded down. (toScaled18ApplyRateRoundDown)
export function toScaled18RoundDown(
  raw: bigint,
  sf: bigint,
  rate: bigint,
): bigint {
  return mulDown(raw * sf, rate);
}

// scaled18 = (raw * scalingFactor) * rate / 1e18, rounded up. (toScaled18ApplyRateRoundUp)
export function toScaled18RoundUp(
  raw: bigint,
  sf: bigint,
  rate: bigint,
): bigint {
  return mulUp(raw * sf, rate);
}

// raw = scaled18 / (scalingFactor * rate / 1e18), rounded down. (toRawUndoRateRoundDown)
export function toRawRoundDown(
  scaled18: bigint,
  sf: bigint,
  rate: bigint,
): bigint {
  return divDown(scaled18, sf * rate);
}

// raw = scaled18 / (scalingFactor * rate / 1e18), rounded up. (toRawUndoRateRoundUp)
export function toRawRoundUp(
  scaled18: bigint,
  sf: bigint,
  rate: bigint,
): bigint {
  return divUp(scaled18, sf * rate);
}

/**
 * EXACT_IN: raw amountOut for a raw amountIn (SwapSide.SELL). Output is fact-capped by
 * RangeMath, so large inputs return the capped output (matching the on-chain query) rather
 * than reverting. Returns 0n for a zero / dust input.
 */
export function computeAmountOut(
  state: PoolState,
  indexIn: number,
  indexOut: number,
  amountInRaw: bigint,
): bigint {
  if (amountInRaw <= 0n) return 0n;

  const rateIn = state.tokenRates[indexIn];
  const rateOut = state.tokenRates[indexOut];

  const amountGivenScaled18 = toScaled18RoundDown(
    amountInRaw,
    state.scalingFactors[indexIn],
    rateIn,
  );

  // Static swap fee is deducted from the input before the pool math (Vault rounds the fee up).
  const swapFee = mulUp(amountGivenScaled18, state.swapFeePercentage);
  const amountInAfterFee = amountGivenScaled18 - swapFee;
  // Vault._swap enforces MINIMUM_TRADE_AMOUNT on the POST-fee scaled input before onSwap
  // (revert TradeAmountTooSmall). Below it the swap reverts on-chain => no price.
  if (amountInAfterFee < state.minimumTradeAmount) return 0n;

  const amountOutScaled18 = calcOutGivenIn(
    state.virtualBalances[indexIn],
    state.weights[indexIn],
    state.virtualBalances[indexOut],
    state.weights[indexOut],
    amountInAfterFee,
    state.balancesLiveScaled18[indexOut],
  );

  // Vault re-checks MINIMUM_TRADE_AMOUNT on the (fact-capped) scaled output after onSwap.
  if (amountOutScaled18 < state.minimumTradeAmount) return 0n;

  return toRawRoundDown(
    amountOutScaled18,
    state.scalingFactors[indexOut],
    computeRateRoundUp(rateOut),
  );
}

/**
 * EXACT_OUT: raw amountIn required for a raw amountOut (SwapSide.BUY). Returns `null` when the
 * swap would revert on-chain (output exceeds the fact-balance reserve or the out-token virtual
 * balance — see `isExactOutAllowed`); the caller treats this as no price for that amount.
 */
export function computeAmountIn(
  state: PoolState,
  indexIn: number,
  indexOut: number,
  amountOutRaw: bigint,
): bigint | null {
  if (amountOutRaw <= 0n) return 0n;

  const rateIn = state.tokenRates[indexIn];
  const rateOut = state.tokenRates[indexOut];

  const amountOutScaled18 = toScaled18RoundUp(
    amountOutRaw,
    state.scalingFactors[indexOut],
    computeRateRoundUp(rateOut),
  );

  // Vault._swap enforces MINIMUM_TRADE_AMOUNT on the given scaled output before onSwap.
  if (amountOutScaled18 < state.minimumTradeAmount) return null;

  if (
    !isExactOutAllowed(
      amountOutScaled18,
      state.balancesLiveScaled18[indexOut],
      state.virtualBalances[indexOut],
    )
  ) {
    return null;
  }

  const amountInScaled18 = calcInGivenOut(
    state.virtualBalances[indexIn],
    state.weights[indexIn],
    state.virtualBalances[indexOut],
    state.weights[indexOut],
    amountOutScaled18,
  );

  // Vault re-checks MINIMUM_TRADE_AMOUNT on onSwap's return — the AMM input BEFORE the
  // fee gross-up below (that matches Vault._swap's second _ensureValidSwapAmount).
  if (amountInScaled18 < state.minimumTradeAmount) return null;

  // Static swap fee is added on top of the input: fee = in * f / (1 - f), rounded up
  // (Vault.mulDivUp). Keeps EXACT_OUT symmetric with the EXACT_IN fee deduction.
  const denominator = complement(state.swapFeePercentage);
  const product = amountInScaled18 * state.swapFeePercentage;
  const swapFee = product === 0n ? 0n : (product - 1n) / denominator + 1n;
  const amountInWithFee = amountInScaled18 + swapFee;

  return toRawRoundUp(amountInWithFee, state.scalingFactors[indexIn], rateIn);
}
