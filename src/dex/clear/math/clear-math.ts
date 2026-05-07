import { ClearVaultState, AssetOracleState, VaultTokenState } from '../types';

export type SwapOutput = {
  amountOut: bigint;
  ious: bigint;
};

const BPS = 10_000n;
const PRICE_DECIMALS = 8n;
const VAULT_DECIMALS = 18n;

// Mirrors ClearOracle._getSwapData: pure conversion using the 8-decimal USD prices.
export function oracleAmountOut(
  fromOracle: AssetOracleState,
  toOracle: AssetOracleState,
  amountIn: bigint,
): bigint {
  const fromBase =
    (amountIn * fromOracle.price) / 10n ** BigInt(fromOracle.assetDecimals);
  return (fromBase * 10n ** BigInt(toOracle.assetDecimals)) / toOracle.price;
}

// Runs the four amount-invariant depeg/redemption guards from ClearSwap._calculateSwapOutput.
// Returns the IOU-redemption pivot (min of from/to redemption prices) on success, null otherwise.
export function validateDepeg(
  fromOracle: AssetOracleState,
  toOracle: AssetOracleState,
  depegThresholdBps: bigint,
  maximalDepegThresholdBps: bigint,
): { iouRedemption: bigint } | null {
  const fromPrice = fromOracle.price;
  const toPrice = toOracle.price;
  if (fromPrice === 0n || toPrice === 0n) return null;
  if (fromPrice > (toPrice * depegThresholdBps) / BPS) return null;
  if (fromPrice >= fromOracle.redemptionPrice) return null;
  if (fromPrice < (toPrice * maximalDepegThresholdBps) / BPS) return null;
  if (toPrice < (toOracle.redemptionPrice * depegThresholdBps) / BPS)
    return null;

  const iouRedemption =
    fromOracle.redemptionPrice < toOracle.redemptionPrice
      ? fromOracle.redemptionPrice
      : toOracle.redemptionPrice;
  return { iouRedemption };
}

// Computes amountOut + ious for a single amount; assumes validateDepeg has already passed.
export function computeSwapOutputs(
  fromOracle: AssetOracleState,
  toOracle: AssetOracleState,
  amountIn: bigint,
  iouRedemption: bigint,
): SwapOutput {
  if (amountIn === 0n) return { amountOut: 0n, ious: 0n };
  const amountOut = oracleAmountOut(fromOracle, toOracle, amountIn);
  let ious = 0n;
  if (fromOracle.price < iouRedemption) {
    const iousBase =
      (amountIn * (iouRedemption - fromOracle.price)) / 10n ** PRICE_DECIMALS;
    ious = (iousBase * 10n ** PRICE_DECIMALS) / toOracle.price;
  }
  return { amountOut, ious };
}

// Mirrors `ious - ious * (lp + treasury) / 10000` from ClearSwap.previewSwap.
export function applyIouFees(
  ious: bigint,
  iouLpFeeBps: bigint,
  iouTreasuryFeeBps: bigint,
): bigint {
  if (ious === 0n) return 0n;
  return ious - (ious * (iouLpFeeBps + iouTreasuryFeeBps)) / BPS;
}

export function availableLiquidity(token: VaultTokenState): bigint {
  return token.cachedAssets;
}

// Pre-computed amount-invariant inputs to checkExposureAfterSwap.
export type ExposureContext = {
  exposureDenominator: bigint;
  fromCachedScaled: bigint;
  fromDecimals: number;
  maxExposureBps: bigint;
};

// Builds the exposure context once per pool so the per-amount check is O(1).
// Mirrors ClearVault._checkMaximalExposure: numerator = (cachedAssets_from + amountIn) scaled to 18,
// denominator = totalSupply * index / 10000 (snapshot from last refreshIndex).
export function makeExposureContext(
  vault: ClearVaultState,
  fromTokenAddr: string,
): ExposureContext | null {
  const fromToken = vault.tokens[fromTokenAddr.toLowerCase()];
  if (!fromToken) return null;
  return {
    exposureDenominator: vault.exposureDenominator,
    fromCachedScaled: scaleToVaultDecimals(
      fromToken.cachedAssets,
      fromToken.decimals,
    ),
    fromDecimals: fromToken.decimals,
    maxExposureBps: fromToken.maxExposureBps,
  };
}

// O(1) post-swap exposure check; matches the contract's denominator semantics.
export function checkExposureAfterSwap(
  ctx: ExposureContext,
  amountIn: bigint,
): boolean {
  if (ctx.exposureDenominator === 0n) return true;
  const amountInScaled = scaleToVaultDecimals(amountIn, ctx.fromDecimals);
  const newFromExposureBps =
    ((ctx.fromCachedScaled + amountInScaled) * BPS) / ctx.exposureDenominator;
  return newFromExposureBps <= ctx.maxExposureBps;
}

export function scaleToVaultDecimals(amount: bigint, decimals: number): bigint {
  if (decimals === Number(VAULT_DECIMALS)) return amount;
  if (decimals < Number(VAULT_DECIMALS)) {
    return amount * 10n ** (VAULT_DECIMALS - BigInt(decimals));
  }
  return amount / 10n ** (BigInt(decimals) - VAULT_DECIMALS);
}
