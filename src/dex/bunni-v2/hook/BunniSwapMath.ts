import { _computeSwap } from '../ldf';
import { FullMathX96 } from '../lib/FullMathX96';
import { IdleBalanceLibrary } from '../lib/IdleBalance';
import { max, min, roundTick, subReLU } from '../lib/Math';
import { queryLDF } from '../lib/QueryLDF';
import { TickMath } from '../lib/TickMath';
import { BunniComputeSwapInput, DexParams } from '../types';
import { computeSwapStep, getSqrtPriceTarget } from './SwapMath';

const EPSILON_FEE: bigint = 30n;

export function computeSwap(
  input: BunniComputeSwapInput,
  dexParams: DexParams,
): {
  updatedSqrtPriceX96: bigint;
  updatedTick: bigint;
  inputAmount: bigint;
  outputAmount: bigint;
} {
  const zeroForOne: boolean = input.swapParams.zeroForOne;
  const exactIn: boolean = input.swapParams.amountSpecified < 0n;

  let updatedSqrtPriceX96: bigint = 0n;
  let inputAmount = exactIn ? -input.swapParams.amountSpecified : 0n;
  let outputAmount = exactIn ? 0n : input.swapParams.amountSpecified;

  const updatedRoundedTickLiquidity =
    (input.totalLiquidity * input.liquidityDensityOfRoundedTickX96) >> 96n;

  let updatedTick = input.currentTick;

  let sqrtPriceLimitX96: bigint = input.swapParams.sqrtPriceLimitX96;
  const minSqrtPrice: bigint = TickMath.getSqrtPriceAtTick(
    TickMath.minUsableTick(input.key.tickSpacing),
  );
  const maxSqrtPrice: bigint = TickMath.getSqrtPriceAtTick(
    TickMath.maxUsableTick(input.key.tickSpacing),
  );
  if (
    (zeroForOne && sqrtPriceLimitX96 <= minSqrtPrice) ||
    (!zeroForOne && sqrtPriceLimitX96 >= maxSqrtPrice)
  ) {
    sqrtPriceLimitX96 = zeroForOne ? minSqrtPrice + 1n : maxSqrtPrice - 1n;
  }

  const { roundedTick, nextRoundedTick } = roundTick(
    input.currentTick,
    input.key.tickSpacing,
  );

  let naiveSwapResultSqrtPriceX96: bigint = 0n;
  let naiveSwapAmountIn: bigint = 0n;
  let naiveSwapAmountOut: bigint = 0n;

  if (updatedRoundedTickLiquidity !== 0n) {
    const tickNext: bigint = zeroForOne ? roundedTick : nextRoundedTick;
    const sqrtPriceNextX96: bigint = TickMath.getSqrtPriceAtTick(tickNext);

    ({
      sqrtPriceNextX96: naiveSwapResultSqrtPriceX96,
      amountIn: naiveSwapAmountIn,
      amountOut: naiveSwapAmountOut,
    } = computeSwapStep(
      input.sqrtPriceX96,
      getSqrtPriceTarget(zeroForOne, sqrtPriceNextX96, sqrtPriceLimitX96),
      updatedRoundedTickLiquidity,
      input.swapParams.amountSpecified,
      0n,
    ));

    if (
      exactIn
        ? naiveSwapAmountIn === -input.swapParams.amountSpecified
        : naiveSwapAmountOut === input.swapParams.amountSpecified
    ) {
      if (naiveSwapResultSqrtPriceX96 === sqrtPriceNextX96) {
        updatedTick = zeroForOne ? tickNext - 1n : tickNext;
      } else if (naiveSwapResultSqrtPriceX96 !== input.sqrtPriceX96) {
        updatedTick = TickMath.getTickAtSqrtPrice(naiveSwapResultSqrtPriceX96);
      }

      naiveSwapAmountOut = min(
        naiveSwapAmountOut,
        zeroForOne ? input.currentActiveBalance1 : input.currentActiveBalance0,
      );

      return {
        updatedSqrtPriceX96: naiveSwapResultSqrtPriceX96,
        updatedTick,
        inputAmount: naiveSwapAmountIn,
        outputAmount: naiveSwapAmountOut,
      };
    }
  }

  // swap crosses rounded tick
  let inverseCumulativeAmountFnInput: bigint = 0n;
  if (exactIn) {
    inverseCumulativeAmountFnInput = zeroForOne
      ? input.currentActiveBalance0 + inputAmount
      : input.currentActiveBalance1 + inputAmount;
  } else {
    inverseCumulativeAmountFnInput = zeroForOne
      ? input.currentActiveBalance1 - outputAmount
      : input.currentActiveBalance0 - outputAmount;
  }

  // LDF compute swap
  let {
    success,
    roundedTick: updatedRoundedTick,
    cumulativeAmount0_: cumulativeAmount0,
    cumulativeAmount1_: cumulativeAmount1,
    swapLiquidity,
  } = _computeSwap(
    input.key,
    inverseCumulativeAmountFnInput,
    input.totalLiquidity,
    zeroForOne,
    exactIn,
    input.arithmeticMeanTick,
    input.currentTick,
    input.ldfParams,
    input.ldfState,
    input.liquidityDensityFunction,
    dexParams,
  );

  if (success) {
    if (
      zeroForOne
        ? updatedRoundedTick >= roundedTick
        : updatedRoundedTick <= roundedTick
    ) {
      if (updatedRoundedTickLiquidity === 0n) {
        return {
          updatedSqrtPriceX96: input.sqrtPriceX96,
          updatedTick: input.currentTick,
          inputAmount: 0n,
          outputAmount: 0n,
        };
      }

      const _tickNext = zeroForOne ? roundedTick : nextRoundedTick;
      if (
        naiveSwapResultSqrtPriceX96 === TickMath.getSqrtPriceAtTick(_tickNext)
      ) {
        updatedTick = zeroForOne ? _tickNext - 1n : _tickNext;
      } else if (naiveSwapResultSqrtPriceX96 !== input.sqrtPriceX96) {
        updatedTick = TickMath.getTickAtSqrtPrice(naiveSwapResultSqrtPriceX96);
      }

      naiveSwapAmountOut = min(
        naiveSwapAmountOut,
        zeroForOne ? input.currentActiveBalance1 : input.currentActiveBalance0,
      );

      return {
        updatedSqrtPriceX96: naiveSwapResultSqrtPriceX96,
        updatedTick,
        inputAmount: naiveSwapAmountIn,
        outputAmount: naiveSwapAmountOut,
      };
    }

    const tickStart = zeroForOne
      ? updatedRoundedTick + input.key.tickSpacing
      : updatedRoundedTick;
    const tickNext = zeroForOne
      ? updatedRoundedTick
      : updatedRoundedTick + input.key.tickSpacing;
    const startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickStart);

    if (
      (zeroForOne && sqrtPriceLimitX96 <= startSqrtPriceX96) ||
      (!zeroForOne && sqrtPriceLimitX96 >= startSqrtPriceX96)
    ) {
      const sqrtPriceNextX96 = TickMath.getSqrtPriceAtTick(tickNext);

      if (zeroForOne) {
        cumulativeAmount0 = max(cumulativeAmount0, input.currentActiveBalance0);
      } else {
        cumulativeAmount1 = max(cumulativeAmount1, input.currentActiveBalance1);
      }

      let hitSqrtPriceLimit: boolean = false;
      if (swapLiquidity === 0n || sqrtPriceLimitX96 === startSqrtPriceX96) {
        [naiveSwapResultSqrtPriceX96, naiveSwapAmountIn, naiveSwapAmountOut] = [
          startSqrtPriceX96,
          0n,
          0n,
        ];
      } else {
        const amountSpecifiedRemaining = exactIn
          ? -(
              inverseCumulativeAmountFnInput -
              (zeroForOne ? cumulativeAmount0 : cumulativeAmount1)
            )
          : (zeroForOne ? cumulativeAmount1 : cumulativeAmount0) -
            inverseCumulativeAmountFnInput;

        ({
          sqrtPriceNextX96: naiveSwapResultSqrtPriceX96,
          amountIn: naiveSwapAmountIn,
          amountOut: naiveSwapAmountOut,
        } = computeSwapStep(
          startSqrtPriceX96,
          getSqrtPriceTarget(zeroForOne, sqrtPriceNextX96, sqrtPriceLimitX96),
          swapLiquidity,
          amountSpecifiedRemaining,
          EPSILON_FEE,
        ));

        if (
          naiveSwapResultSqrtPriceX96 === sqrtPriceLimitX96 &&
          sqrtPriceLimitX96 !== sqrtPriceNextX96
        ) {
          hitSqrtPriceLimit = true;
        }
      }

      if (!hitSqrtPriceLimit) {
        updatedTick = tickStart;

        if (naiveSwapResultSqrtPriceX96 === sqrtPriceNextX96) {
          updatedTick = zeroForOne ? tickNext - 1n : tickNext;
        } else if (naiveSwapResultSqrtPriceX96 !== startSqrtPriceX96) {
          updatedTick = TickMath.getTickAtSqrtPrice(
            naiveSwapResultSqrtPriceX96,
          );
        }

        updatedSqrtPriceX96 = naiveSwapResultSqrtPriceX96;

        if (
          exactIn
            ? naiveSwapAmountIn === -input.swapParams.amountSpecified
            : naiveSwapAmountOut === input.swapParams.amountSpecified
        ) {
          naiveSwapAmountOut = min(
            naiveSwapAmountOut,
            zeroForOne
              ? input.currentActiveBalance1
              : input.currentActiveBalance0,
          );
          return {
            updatedSqrtPriceX96: naiveSwapResultSqrtPriceX96,
            updatedTick,
            inputAmount: naiveSwapAmountIn,
            outputAmount: naiveSwapAmountOut,
          };
        }

        if (
          (zeroForOne && cumulativeAmount1 < naiveSwapAmountOut) ||
          (!zeroForOne && cumulativeAmount0 < naiveSwapAmountOut)
        ) {
          throw new Error('BunniSwapMath__SwapFailed()');
        }

        const updatedActiveBalance0 = zeroForOne
          ? cumulativeAmount0 + naiveSwapAmountIn
          : cumulativeAmount0 - naiveSwapAmountOut;
        const updatedActiveBalance1 = zeroForOne
          ? cumulativeAmount1 - naiveSwapAmountOut
          : cumulativeAmount1 + naiveSwapAmountIn;

        inputAmount = zeroForOne
          ? updatedActiveBalance0 - input.currentActiveBalance0
          : updatedActiveBalance1 - input.currentActiveBalance1;
        outputAmount = zeroForOne
          ? subReLU(input.currentActiveBalance1, updatedActiveBalance1)
          : subReLU(input.currentActiveBalance0, updatedActiveBalance0);
        return { updatedSqrtPriceX96, updatedTick, inputAmount, outputAmount };
      }
    }
  }

  updatedSqrtPriceX96 = sqrtPriceLimitX96;
  updatedTick =
    sqrtPriceLimitX96 === input.sqrtPriceX96
      ? input.currentTick
      : TickMath.getTickAtSqrtPrice(sqrtPriceLimitX96);

  const { totalDensity0X96, totalDensity1X96 } = queryLDF(
    input.key,
    updatedSqrtPriceX96,
    updatedTick,
    input.arithmeticMeanTick,
    input.liquidityDensityFunction,
    input.ldfParams,
    input.ldfState,
    0n,
    0n,
    IdleBalanceLibrary.ZERO,
    dexParams,
  );

  const _updatedActiveBalance0 = FullMathX96.fullMulX96Up(
    totalDensity0X96,
    input.totalLiquidity,
  );
  const _updatedActiveBalance1 = FullMathX96.fullMulX96Up(
    totalDensity1X96,
    input.totalLiquidity,
  );

  if (zeroForOne) {
    inputAmount = _updatedActiveBalance0 - input.currentActiveBalance0;
    outputAmount = subReLU(input.currentActiveBalance1, _updatedActiveBalance1);
  } else {
    inputAmount = _updatedActiveBalance1 - input.currentActiveBalance1;
    subReLU(input.currentActiveBalance0, _updatedActiveBalance0);
  }

  return { updatedSqrtPriceX96, updatedTick, inputAmount, outputAmount };
}
