import {
  LN2_WAD,
  MAX_SWAP_FEE_RATIO,
  SWAP_FEE_BASE,
  SWAP_FEE_BASE_SQUARED,
} from './Constants';
import { dist, expWad, max, min, mulDiv, mulDivUp, mulWadUp } from './Math';
import { TickMath } from './TickMath';

export function computeSurgeFee(
  lastSurgeTimestamp: bigint,
  surgeFeeHalfLife: bigint,
  blockTimestamp: bigint,
): bigint {
  const timeSinceLastSurge: bigint = blockTimestamp - lastSurgeTimestamp;

  return mulWadUp(
    SWAP_FEE_BASE,
    expWad(-mulDiv(timeSinceLastSurge, LN2_WAD, surgeFeeHalfLife)),
  );
}

export function computeDynamicSwapFee(
  postSwapSqrtPriceX96: bigint,
  arithmeticMeanTick: bigint,
  lastSurgeTimestamp: bigint,
  feeMin: bigint,
  feeMax: bigint,
  feeQuadraticMultiplier: bigint,
  surgeFeeHalfLife: bigint,
  blockTimestamp: bigint,
): bigint {
  // compute surge fee
  // surge fee gets applied after the LDF shifts (if it's dynamic)
  let fee: bigint = computeSurgeFee(
    lastSurgeTimestamp,
    surgeFeeHalfLife,
    blockTimestamp,
  );

  // special case for fixed fee pools
  if (feeQuadraticMultiplier === 0n || feeMin === feeMax)
    return max(feeMin, fee);

  let ratio = mulDiv(
    postSwapSqrtPriceX96,
    SWAP_FEE_BASE,
    TickMath.getSqrtPriceAtTick(arithmeticMeanTick),
  );
  if (ratio > MAX_SWAP_FEE_RATIO) ratio = MAX_SWAP_FEE_RATIO;
  ratio = mulDiv(ratio, ratio, SWAP_FEE_BASE);
  const delta = dist(ratio, SWAP_FEE_BASE);

  const quadraticTerm = mulDivUp(
    feeQuadraticMultiplier,
    delta * delta,
    SWAP_FEE_BASE_SQUARED,
  );
  return max(fee, min(feeMin + quadraticTerm, feeMax));
}
