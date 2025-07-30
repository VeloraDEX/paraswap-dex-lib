import { DexParams, PoolKey } from '../types';

export function _query(
  key: PoolKey,
  roundedTick: bigint,
  twapTick: bigint,
  spotPriceTick: bigint,
  ldfParams: string,
  ldfState: string,
  liquidityDensityFunction: string,
  dexParams: DexParams,
): {
  liquidityDensityX96_: bigint;
  cumulativeAmount0DensityX96: bigint;
  cumulativeAmount1DensityX96: bigint;
  newLdfState: string;
  shouldSurge: boolean;
} {
  const map = dexParams.liquidityDensityFunctions ?? {};
  const module = map[liquidityDensityFunction.toLowerCase()];

  if (!module) {
    throw new Error(
      `LiquidityDensityFunction ${liquidityDensityFunction} not yet supported`,
    );
  }

  return module.query(
    key,
    roundedTick,
    twapTick,
    spotPriceTick,
    ldfParams,
    ldfState,
  );
}

export function _computeSwap(
  key: PoolKey,
  inverseCumulativeAmountInput: bigint,
  totalLiquidity: bigint,
  zeroForOne: boolean,
  exactIn: boolean,
  twapTick: bigint,
  spotPriceTick: bigint,
  ldfParams: string,
  ldfState: string,
  liquidityDensityFunction: string,
  dexParams: DexParams,
): {
  success: boolean;
  roundedTick: bigint;
  cumulativeAmount0_: bigint;
  cumulativeAmount1_: bigint;
  swapLiquidity: bigint;
} {
  const map = dexParams.liquidityDensityFunctions ?? {};
  const module = map[liquidityDensityFunction.toLowerCase()];

  if (!module) {
    throw new Error(
      `LiquidityDensityFunction ${liquidityDensityFunction} not yet supported`,
    );
  }

  return module.computeSwap(
    key,
    inverseCumulativeAmountInput,
    totalLiquidity,
    zeroForOne,
    exactIn,
    twapTick,
    spotPriceTick,
    ldfParams,
    ldfState,
  );
}
