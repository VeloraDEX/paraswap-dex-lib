import { PoolKey } from '../types';
import { CarpetedDoubleGeometricDistribution } from './CarpetedDoubleGeometricDistribution';
import { CarpetedGeometricDistribution } from './CarpetedGeometricDistribution';
import { DoubleGeometricDistribution } from './DoubleGeometricDistribution';
import { GeometricDistribution } from './GeometricDistribution';
import { UniformDistribution } from './UniformDistribution';

const LiquidityDensityFunctions: Record<string, any> = {
  // 1.2.1
  ['0x00000000d5248262c18C5a8c706B2a3E740B8760'.toLowerCase()]:
    UniformDistribution,
  ['0x00000000B79037C909ff75dAFbA91b374bE2124f'.toLowerCase()]:
    GeometricDistribution,
  ['0x000000004a3e16323618D0E43e93b4DD64151eDB'.toLowerCase()]:
    DoubleGeometricDistribution,
  ['0x000000007cA9919151b275FABEA64A4f557Aa1F6'.toLowerCase()]:
    CarpetedGeometricDistribution,
  ['0x000000000b757686c9596caDA54fa28f8C429E0d'.toLowerCase()]:
    CarpetedDoubleGeometricDistribution,

  // 1.2.1 (on Aribtrum)
  ['0x00000000Ca63Db33B83c0048De8B29e0FF3eb085'.toLowerCase()]:
    UniformDistribution,
  ['0x00000000Cf810fBCDd50699c7934E6a3bA76C6f7'.toLowerCase()]:
    GeometricDistribution,
  ['0x000000008F092B3A2eD144A4b9A6E17c4C90d8be'.toLowerCase()]:
    DoubleGeometricDistribution,
  ['0x00000000db3bb322a6c5866C3f0290a4b3eC858A'.toLowerCase()]:
    CarpetedGeometricDistribution,
  ['0x00000000f5cf92Bf887e22E1800fA15A2375B4b9'.toLowerCase()]:
    CarpetedDoubleGeometricDistribution,
};

export function _query(
  key: PoolKey,
  roundedTick: bigint,
  twapTick: bigint,
  spotPriceTick: bigint,
  ldfParams: string,
  ldfState: string,
  liquidityDensityFunction: string,
): {
  liquidityDensityX96_: bigint;
  cumulativeAmount0DensityX96: bigint;
  cumulativeAmount1DensityX96: bigint;
  newLdfState: string;
  shouldSurge: boolean;
} {
  const module =
    LiquidityDensityFunctions[liquidityDensityFunction.toLowerCase()];

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
): {
  success: boolean;
  roundedTick: bigint;
  cumulativeAmount0_: bigint;
  cumulativeAmount1_: bigint;
  swapLiquidity: bigint;
} {
  const module =
    LiquidityDensityFunctions[liquidityDensityFunction.toLowerCase()];

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
