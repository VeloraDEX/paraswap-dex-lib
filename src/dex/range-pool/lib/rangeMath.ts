/**
 * Range Pool swap math — a 1:1 TypeScript port of
 * `balancer-v3-monorepo/pkg/pool-range/contracts/RangeMath.sol`.
 *
 * Weighted-product math on *virtual* balances, with output capped by the actual (fact)
 * balance. All amounts/balances/weights are scaled18 (WAD). Rounding direction matches the
 * Solidity library exactly (verified bit-for-bit against `Router.querySwap...` on a fork).
 */

import {
  complement,
  divDown,
  divUp,
  mulDown,
  mulUp,
  powUp,
  WAD,
} from './fixedPoint';

/**
 * Minimum token balance that must remain in the pool after any swap
 * (RangeMath.ABSOLUTE_MIN_TOKEN_BALANCE). Output is capped at `factBalanceOut - this`.
 */
export const ABSOLUTE_MIN_TOKEN_BALANCE = 1_000_000n; // 1e6

/**
 * Exact-in: amountOut given amountIn, on virtual balances, capped by fact balance.
 * Mirrors RangeMath.calcOutGivenIn (no MaxInRatio guard — the fact cap is the limiter).
 *
 *   aO = bO * (1 - (bI / (bI + aI))^(wI/wO)),  then  aO = min(aO, factBalanceOut - 1e6)
 */
export function calcOutGivenIn(
  virtualBalanceIn: bigint,
  weightIn: bigint,
  virtualBalanceOut: bigint,
  weightOut: bigint,
  amountIn: bigint,
  factBalanceOut: bigint,
): bigint {
  const denominator = virtualBalanceIn + amountIn;
  const base = divUp(virtualBalanceIn, denominator);
  const exponent = divDown(weightIn, weightOut);
  const power = powUp(base, exponent);

  const uncapped = mulDown(virtualBalanceOut, complement(power));

  const maxOut =
    factBalanceOut > ABSOLUTE_MIN_TOKEN_BALANCE
      ? factBalanceOut - ABSOLUTE_MIN_TOKEN_BALANCE
      : 0n;

  return uncapped < maxOut ? uncapped : maxOut;
}

/**
 * Exact-out: amountIn required for a given amountOut, on virtual balances.
 * Mirrors RangeMath.calcInGivenOut. Caller must enforce the onSwap guards (see
 * `assertExactOutAllowed`) before relying on this — here `amountOut < virtualBalanceOut`
 * is assumed (otherwise the base would be non-positive).
 *
 *   aI = bI * ((bO / (bO - aO))^(wO/wI) - 1)
 */
export function calcInGivenOut(
  virtualBalanceIn: bigint,
  weightIn: bigint,
  virtualBalanceOut: bigint,
  weightOut: bigint,
  amountOut: bigint,
): bigint {
  // Short-circuit: zero out requires zero in (matches the Solidity guard that avoids a
  // dust charge from powUp rounding on base == 1e18).
  if (amountOut === 0n) return 0n;

  const base = divUp(virtualBalanceOut, virtualBalanceOut - amountOut);
  const exponent = divUp(weightOut, weightIn);
  const power = powUp(base, exponent);

  const ratio = power - WAD;
  return mulUp(virtualBalanceIn, ratio);
}

/**
 * The onSwap-level guards for EXACT_OUT (RangePool.onSwap). Returns true if the swap is
 * allowed; false means the Vault would revert (treat as no liquidity).
 *   - amountOut + ABSOLUTE_MIN_TOKEN_BALANCE must be <= factBalanceOut
 *   - amountOut must be < virtualBalanceOut
 */
export function isExactOutAllowed(
  amountOut: bigint,
  factBalanceOut: bigint,
  virtualBalanceOut: bigint,
): boolean {
  if (amountOut + ABSOLUTE_MIN_TOKEN_BALANCE > factBalanceOut) return false;
  if (amountOut >= virtualBalanceOut) return false;
  return true;
}

/**
 * Spot price of the quote token in base-token terms (scaled18): base per 1 quote.
 * Mirrors RangeMath.calcSpotPrice. (Same as ranges-stats/workers/lib/spotPrice.ts.)
 */
export function calcSpotPrice(
  virtualBalanceBase: bigint,
  weightBase: bigint,
  virtualBalanceQuote: bigint,
  weightQuote: bigint,
): bigint {
  return divDown(
    mulDown(divDown(virtualBalanceBase, virtualBalanceQuote), weightQuote),
    weightBase,
  );
}
