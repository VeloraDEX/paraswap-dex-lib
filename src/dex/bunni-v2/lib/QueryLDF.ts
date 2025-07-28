import { _query } from '../ldf';
import { DexParams, PoolKey } from '../types';
import { Q96, ZERO_BYTES_32 } from './Constants';
import { FullMathX96 } from './FullMathX96';
import { IdleBalance, IdleBalanceLibrary } from './IdleBalance';
import { LiquidityAmounts } from './LiquidityAmounts';
import {
  min,
  mulDiv,
  roundTick,
  roundUpFullMulDivResult,
  subReLU,
} from './Math';
import { TickMath } from './TickMath';

export function queryLDF(
  key: PoolKey,
  sqrtPriceX96: bigint,
  tick: bigint,
  arithmeticMeanTick: bigint,
  ldf: string,
  ldfParams: string,
  ldfState: string,
  balance0: bigint,
  balance1: bigint,
  idleBalance: IdleBalance,
  dexParams: DexParams,
): {
  totalLiquidity: bigint;
  totalDensity0X96: bigint;
  totalDensity1X96: bigint;
  liquidityDensityOfRoundedTickX96: bigint;
  activeBalance0: bigint;
  activeBalance1: bigint;
  newLdfState: string;
  shouldSurge: boolean;
} {
  let totalLiquidity: bigint = 0n;
  let totalDensity0X96: bigint = 0n;
  let totalDensity1X96: bigint = 0n;
  let liquidityDensityOfRoundedTickX96: bigint = 0n;
  let activeBalance0: bigint = 0n;
  let activeBalance1: bigint = 0n;
  let newLdfState: string = ZERO_BYTES_32;
  let shouldSurge: boolean = false;

  const { roundedTick, nextRoundedTick } = roundTick(tick, key.tickSpacing);

  const roundedTickSqrtRatio: bigint = TickMath.getSqrtPriceAtTick(roundedTick);
  const nextRoundedTickSqrtRatio: bigint =
    TickMath.getSqrtPriceAtTick(nextRoundedTick);

  let density0RightOfRoundedTickX96;
  let density1LeftOfRoundedTickX96;

  ({
    liquidityDensityX96_: liquidityDensityOfRoundedTickX96,
    cumulativeAmount0DensityX96: density0RightOfRoundedTickX96,
    cumulativeAmount1DensityX96: density1LeftOfRoundedTickX96,
    newLdfState,
    shouldSurge,
  } = _query(
    key,
    roundedTick,
    arithmeticMeanTick,
    tick,
    ldfParams,
    ldfState,
    ldf,
    dexParams,
  ));

  const {
    amount0: density0OfRoundedTickX96,
    amount1: density1OfRoundedTickX96,
  } = LiquidityAmounts.getAmountsForLiquidity(
    sqrtPriceX96,
    roundedTickSqrtRatio,
    nextRoundedTickSqrtRatio,
    liquidityDensityOfRoundedTickX96,
    true,
  );

  totalDensity0X96 = density0RightOfRoundedTickX96 + density0OfRoundedTickX96;
  totalDensity1X96 = density1LeftOfRoundedTickX96 + density1OfRoundedTickX96;

  if (!shouldSurge) {
    const { rawBalance, isToken0 } =
      IdleBalanceLibrary.fromIdleBalance(idleBalance);
    if (isToken0) {
      balance0 = subReLU(balance0, rawBalance);
    } else {
      balance1 = subReLU(balance1, rawBalance);
    }
  }

  if (balance0 !== 0n || balance1 !== 0n) {
    const noToken0: boolean = balance0 === 0n || totalDensity0X96 === 0n;
    const noToken1: boolean = balance1 === 0n || totalDensity1X96 === 0n;
    const totalLiquidityEstimate0: bigint = noToken0
      ? 0n
      : mulDiv(balance0, Q96, totalDensity0X96);
    const totalLiquidityEstimate1: bigint = noToken1
      ? 0n
      : mulDiv(balance1, Q96, totalDensity1X96);
    const useLiquidityEstimate0: boolean =
      (totalLiquidityEstimate0 < totalLiquidityEstimate1 ||
        totalDensity1X96 === 0n) &&
      totalDensity0X96 !== 0n;

    if (useLiquidityEstimate0) {
      totalLiquidity = noToken0
        ? 0n
        : roundUpFullMulDivResult(
            balance0,
            Q96,
            totalDensity0X96,
            totalLiquidityEstimate0,
          );
      activeBalance0 = noToken0
        ? 0n
        : min(
            balance0,
            FullMathX96.fullMulX96(totalLiquidityEstimate0, totalDensity0X96),
          );
      activeBalance1 = noToken1
        ? 0n
        : min(
            balance1,
            FullMathX96.fullMulX96(totalLiquidityEstimate0, totalDensity1X96),
          );
    } else {
      totalLiquidity = noToken1
        ? 0n
        : roundUpFullMulDivResult(
            balance1,
            Q96,
            totalDensity1X96,
            totalLiquidityEstimate1,
          );
      activeBalance0 = noToken0
        ? 0n
        : min(
            balance0,
            FullMathX96.fullMulX96(totalLiquidityEstimate1, totalDensity0X96),
          );
      activeBalance1 = noToken1
        ? 0n
        : min(
            balance1,
            FullMathX96.fullMulX96(totalLiquidityEstimate1, totalDensity1X96),
          );
    }
  }

  return {
    totalLiquidity,
    totalDensity0X96,
    totalDensity1X96,
    liquidityDensityOfRoundedTickX96,
    activeBalance0,
    activeBalance1,
    newLdfState,
    shouldSurge,
  };
}
