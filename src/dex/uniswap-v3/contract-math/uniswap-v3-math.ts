import { OutputResult, PoolState, Slot0, TickInfo } from '../types';
import { LiquidityMath } from './LiquidityMath';
import { Oracle } from './Oracle';
import { SqrtPriceMath } from './SqrtPriceMath';
import { SwapMath } from './SwapMath';
import { Tick } from './Tick';
import { TickBitMap } from './TickBitMap';
import { TickMath } from './TickMath';
import { _require } from '../../../utils';
import { DeepReadonly } from 'ts-essentials';
import { NumberAsString, SwapSide } from '@paraswap/core';
import { BI_MAX_INT } from '../../../bigint-constants';
import {
  MAX_PRICING_COMPUTATION_STEPS_ALLOWED,
  OUT_OF_RANGE_ERROR_POSTFIX,
} from '../constants';
import { Logger } from 'log4js';

type ModifyPositionParams = {
  tickLower: bigint;
  tickUpper: bigint;
  liquidityDelta: bigint;
};

export type PriceComputationState = {
  amountSpecifiedRemaining: bigint;
  amountCalculated: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
  protocolFee: bigint;
  liquidity: bigint;
  isFirstCycleState: boolean;
};

export type PriceComputationCache = {
  liquidityStart: bigint;
  blockTimestamp: bigint;
  feeProtocol: bigint;
  secondsPerLiquidityCumulativeX128: bigint;
  tickCumulative: bigint;
  computedLatestObservation: boolean;
  tickCount: number;
};

export function _updatePriceComputationObjects<
  T extends PriceComputationState | PriceComputationCache,
>(toUpdate: T, updateBy: T) {
  for (const k of Object.keys(updateBy) as (keyof T)[]) {
    toUpdate[k] = updateBy[k];
  }
}

function _priceComputationCycles(
  poolState: DeepReadonly<PoolState>,
  ticksCopy: Record<NumberAsString, TickInfo>,
  slot0Start: Slot0,
  state: PriceComputationState,
  cache: PriceComputationCache,
  sqrtPriceLimitX96: bigint,
  zeroForOne: boolean,
  exactInput: boolean,
  side: SwapSide,
  logger?: Logger,
): [
  // result
  PriceComputationState,
  // Latest calculated full cycle state we can use for bigger amounts
  {
    latestFullCycleState: PriceComputationState;
    latestFullCycleCache: PriceComputationCache;
  },
] {
  const latestFullCycleState: PriceComputationState = { ...state };

  if (cache.tickCount == 0) {
    cache.tickCount = 1;
  }
  const latestFullCycleCache: PriceComputationCache = { ...cache };

  // We save tick before any change. Later we use this to restore
  // state before last step
  let lastTicksCopy: { index: number; tick: TickInfo } | undefined;

  let i = 0;
  for (
    ;
    state.amountSpecifiedRemaining !== 0n &&
    state.sqrtPriceX96 !== sqrtPriceLimitX96;
    ++i
  ) {
    if (
      latestFullCycleCache.tickCount + i >
      MAX_PRICING_COMPUTATION_STEPS_ALLOWED
    ) {
      state.amountSpecifiedRemaining = 0n;
      state.amountCalculated = 0n;
      break;
    }

    const step = {
      sqrtPriceStartX96: 0n,
      tickNext: 0n,
      initialized: false,
      sqrtPriceNextX96: 0n,
      amountIn: 0n,
      amountOut: 0n,
      feeAmount: 0n,
    };

    step.sqrtPriceStartX96 = state.sqrtPriceX96;

    try {
      [step.tickNext, step.initialized] =
        TickBitMap.nextInitializedTickWithinOneWord(
          poolState,
          state.tick,
          poolState.tickSpacing,
          zeroForOne,
          true,
        );
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.endsWith(OUT_OF_RANGE_ERROR_POSTFIX)
      ) {
        logger?.warn(
          `INVALID_TICK_BIT_MAP_RANGES for ${poolState.pool}, tick: ${
            state.tick
          }, ticks: ${Object.keys(poolState.ticks).join(
            ',',
          )}, tickBitmap: ${Object.keys(poolState.tickBitmap).join(',')}, ${
            e.message
          }`,
        );
        state.amountSpecifiedRemaining = 0n;
        state.amountCalculated = 0n;
        break;
      }
      throw e;
    }

    if (step.tickNext < TickMath.MIN_TICK) {
      step.tickNext = TickMath.MIN_TICK;
    } else if (step.tickNext > TickMath.MAX_TICK) {
      step.tickNext = TickMath.MAX_TICK;
    }

    step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

    const swapStepResult = SwapMath.computeSwapStep(
      state.sqrtPriceX96,
      (
        zeroForOne
          ? step.sqrtPriceNextX96 < sqrtPriceLimitX96
          : step.sqrtPriceNextX96 > sqrtPriceLimitX96
      )
        ? sqrtPriceLimitX96
        : step.sqrtPriceNextX96,
      state.liquidity,
      state.amountSpecifiedRemaining,
      poolState.fee,
    );

    state.sqrtPriceX96 = swapStepResult.sqrtRatioNextX96;
    step.amountIn = swapStepResult.amountIn;
    step.amountOut = swapStepResult.amountOut;
    step.feeAmount = swapStepResult.feeAmount;

    if (exactInput) {
      state.amountSpecifiedRemaining -= step.amountIn + step.feeAmount;
      state.amountCalculated = state.amountCalculated - step.amountOut;
    } else {
      state.amountSpecifiedRemaining += step.amountOut;
      state.amountCalculated =
        state.amountCalculated + step.amountIn + step.feeAmount;
    }

    if (cache.feeProtocol > 0n) {
      const delta = step.feeAmount / cache.feeProtocol;
      step.feeAmount -= delta;
      state.protocolFee += delta;
    }

    if (state.sqrtPriceX96 === step.sqrtPriceNextX96) {
      if (step.initialized) {
        if (!cache.computedLatestObservation) {
          [cache.tickCumulative, cache.secondsPerLiquidityCumulativeX128] =
            Oracle.observeSingle(
              poolState,
              cache.blockTimestamp,
              0n,
              slot0Start.tick,
              slot0Start.observationIndex,
              cache.liquidityStart,
              slot0Start.observationCardinality,
            );
          cache.computedLatestObservation = true;
        }

        if (state.amountSpecifiedRemaining === 0n) {
          const castTickNext = Number(step.tickNext);
          lastTicksCopy = {
            index: castTickNext,
            tick: { ...ticksCopy[castTickNext] },
          };
        }

        let liquidityNet = Tick.cross(ticksCopy, step.tickNext);
        if (zeroForOne) liquidityNet = -liquidityNet;

        state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
      }

      state.tick = zeroForOne ? step.tickNext - 1n : step.tickNext;
    } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
      state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
    }

    if (state.amountSpecifiedRemaining !== 0n) {
      _updatePriceComputationObjects(latestFullCycleState, state);
      _updatePriceComputationObjects(latestFullCycleCache, cache);
      // If it last cycle, check if ticks were changed and then restore previous state
      // for next calculations
    } else if (lastTicksCopy !== undefined) {
      ticksCopy[lastTicksCopy.index] = lastTicksCopy.tick;
    }
  }

  if (i > 1) {
    latestFullCycleCache.tickCount += i - 1;
  }

  if (state.amountSpecifiedRemaining !== 0n && side === SwapSide.BUY) {
    state.amountSpecifiedRemaining = 0n;
    state.amountCalculated = 0n;
  }

  return [state, { latestFullCycleState, latestFullCycleCache }];
}

class UniswapV3Math {
  queryOutputs(
    poolState: DeepReadonly<PoolState>,
    // Amounts must increase
    amounts: bigint[],
    zeroForOne: boolean,
    side: SwapSide,
    logger?: Logger,
  ): OutputResult {
    const slot0Start = poolState.slot0;

    const isSell = side === SwapSide.SELL;

    const sqrtPriceLimitX96 = zeroForOne
      ? TickMath.MIN_SQRT_RATIO + 1n
      : TickMath.MAX_SQRT_RATIO - 1n;

    const cache: PriceComputationCache = {
      liquidityStart: poolState.liquidity,
      blockTimestamp: this._blockTimestamp(poolState),
      feeProtocol: zeroForOne
        ? slot0Start.feeProtocol % 16n
        : slot0Start.feeProtocol >> 4n,
      secondsPerLiquidityCumulativeX128: 0n,
      tickCumulative: 0n,
      computedLatestObservation: false,
      tickCount: 0,
    };

    const state: PriceComputationState = {
      // Will be overwritten later
      amountSpecifiedRemaining: 0n,
      amountCalculated: 0n,
      sqrtPriceX96: slot0Start.sqrtPriceX96,
      tick: slot0Start.tick,
      protocolFee: 0n,
      liquidity: cache.liquidityStart,
      isFirstCycleState: true,
    };

    let isOutOfRange = false;
    let previousAmount = 0n;

    const outputs = new Array(amounts.length);
    const tickCounts = new Array(amounts.length);
    for (const [i, amount] of amounts.entries()) {
      if (amount === 0n) {
        outputs[i] = 0n;
        tickCounts[i] = 0;
        continue;
      }

      const amountSpecified = isSell
        ? BigInt.asIntN(256, amount)
        : -BigInt.asIntN(256, amount);

      if (state.isFirstCycleState) {
        // Set first non zero amount
        state.amountSpecifiedRemaining = amountSpecified;
        state.isFirstCycleState = false;
      } else {
        state.amountSpecifiedRemaining =
          amountSpecified - (previousAmount - state.amountSpecifiedRemaining);
      }

      const exactInput = amountSpecified > 0n;

      _require(
        zeroForOne
          ? sqrtPriceLimitX96 < slot0Start.sqrtPriceX96 &&
              sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO
          : sqrtPriceLimitX96 > slot0Start.sqrtPriceX96 &&
              sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
        'SPL',
        { zeroForOne, sqrtPriceLimitX96, slot0Start },
        'zeroForOne ? sqrtPriceLimitX96 < slot0Start.sqrtPriceX96 && sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO : sqrtPriceLimitX96 > slot0Start.sqrtPriceX96 && sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO',
      );

      if (!isOutOfRange) {
        const [finalState, { latestFullCycleState, latestFullCycleCache }] =
          _priceComputationCycles(
            poolState,
            poolState.ticks,
            slot0Start,
            state,
            cache,
            sqrtPriceLimitX96,
            zeroForOne,
            exactInput,
            side,
            logger,
          );
        if (
          finalState.amountSpecifiedRemaining === 0n &&
          finalState.amountCalculated === 0n
        ) {
          isOutOfRange = true;
          outputs[i] = 0n;
          tickCounts[i] = 0;
          continue;
        }

        // We use it on next step to correct state.amountSpecifiedRemaining
        previousAmount = amountSpecified;

        // First extract calculated values
        const [amount0, amount1] =
          zeroForOne === exactInput
            ? [
                amountSpecified - finalState.amountSpecifiedRemaining,
                finalState.amountCalculated,
              ]
            : [
                finalState.amountCalculated,
                amountSpecified - finalState.amountSpecifiedRemaining,
              ];

        // Update for next amount
        _updatePriceComputationObjects(state, latestFullCycleState);
        _updatePriceComputationObjects(cache, latestFullCycleCache);

        if (isSell) {
          outputs[i] = BigInt.asUintN(256, -(zeroForOne ? amount1 : amount0));
          tickCounts[i] = latestFullCycleCache.tickCount;
        } else {
          outputs[i] = zeroForOne
            ? BigInt.asUintN(256, amount0)
            : BigInt.asUintN(256, amount1);
          tickCounts[i] = latestFullCycleCache.tickCount;
        }
      } else {
        outputs[i] = 0n;
        tickCounts[i] = 0;
      }
    }

    return {
      outputs,
      tickCounts,
    };
  }

  swapFromEvent(
    poolState: PoolState,
    newSqrtPriceX96: bigint,
    newTick: bigint,
    newLiquidity: bigint,
    zeroForOne: boolean,
  ): void {
    const slot0Start = poolState.slot0;

    const cache = {
      liquidityStart: poolState.liquidity,
      blockTimestamp: this._blockTimestamp(poolState),
      feeProtocol: 0n,
      secondsPerLiquidityCumulativeX128: 0n,
      tickCumulative: 0n,
      computedLatestObservation: false,
    };

    const state = {
      // Because I don't have the exact amount user used, set this number to MAX_NUMBER to proceed
      // with calculations. I think it is not a problem since in loop I don't rely on this value
      // TODO: not sure if this is correct as original `amountSpecifiedRemaining` might be negative for buy cases
      // which then affects `if (amountRemaining >= 0n)` cases on `SwapMath.computeSwapStep`
      amountSpecifiedRemaining: BI_MAX_INT,
      amountCalculated: 0n,
      sqrtPriceX96: slot0Start.sqrtPriceX96,
      tick: slot0Start.tick,
      protocolFee: 0n,
      liquidity: cache.liquidityStart,
    };

    // Because I didn't have all variables, adapted loop stop with state.tick !== newTick
    // condition. This cycle need only to calculate Tick.cross() function values
    // It means that we are interested in cycling only if state.tick !== newTick
    // When they become equivalent, we proceed with state updating part as normal
    // And if assumptions regarding this cycle are correct, we don't need to process
    // the last cycle when state.tick === newTick
    while (state.tick !== newTick && state.sqrtPriceX96 !== newSqrtPriceX96) {
      const step = {
        sqrtPriceStartX96: 0n,
        tickNext: 0n,
        initialized: false,
        sqrtPriceNextX96: 0n,
        amountIn: 0n,
        amountOut: 0n,
        feeAmount: 0n,
      };

      step.sqrtPriceStartX96 = state.sqrtPriceX96;

      [step.tickNext, step.initialized] =
        TickBitMap.nextInitializedTickWithinOneWord(
          poolState,
          state.tick,
          poolState.tickSpacing,
          zeroForOne,
          false,
        );

      if (step.tickNext < TickMath.MIN_TICK) {
        step.tickNext = TickMath.MIN_TICK;
      } else if (step.tickNext > TickMath.MAX_TICK) {
        step.tickNext = TickMath.MAX_TICK;
      }

      step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

      const swapStepResult = SwapMath.computeSwapStep(
        state.sqrtPriceX96,
        (
          zeroForOne
            ? step.sqrtPriceNextX96 < newSqrtPriceX96
            : step.sqrtPriceNextX96 > newSqrtPriceX96
        )
          ? newSqrtPriceX96
          : step.sqrtPriceNextX96,
        state.liquidity,
        state.amountSpecifiedRemaining,
        poolState.fee,
      );

      state.sqrtPriceX96 = swapStepResult.sqrtRatioNextX96;

      if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
        if (step.initialized) {
          if (!cache.computedLatestObservation) {
            [cache.tickCumulative, cache.secondsPerLiquidityCumulativeX128] =
              Oracle.observeSingle(
                poolState,
                cache.blockTimestamp,
                0n,
                slot0Start.tick,
                slot0Start.observationIndex,
                cache.liquidityStart,
                slot0Start.observationCardinality,
              );
            cache.computedLatestObservation = true;
          }

          let liquidityNet = Tick.cross(poolState.ticks, step.tickNext);

          if (zeroForOne) liquidityNet = -liquidityNet;

          state.liquidity = LiquidityMath.addDelta(
            state.liquidity,
            liquidityNet,
          );
        }

        state.tick = zeroForOne ? step.tickNext - 1n : step.tickNext;
      } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
        state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
      }
    }

    if (slot0Start.tick !== newTick) {
      const [observationIndex, observationCardinality] = Oracle.write(
        poolState,
        slot0Start.observationIndex,
        this._blockTimestamp(poolState),
        slot0Start.tick,
        poolState.liquidity,
        slot0Start.observationCardinality,
        slot0Start.observationCardinalityNext,
      );

      [
        poolState.slot0.sqrtPriceX96,
        poolState.slot0.tick,
        poolState.slot0.observationIndex,
        poolState.slot0.observationCardinality,
      ] = [newSqrtPriceX96, newTick, observationIndex, observationCardinality];
    } else {
      poolState.slot0.sqrtPriceX96 = newSqrtPriceX96;
    }

    if (poolState.liquidity !== newLiquidity)
      poolState.liquidity = newLiquidity;
  }

  _modifyPosition(
    state: PoolState,
    params: ModifyPositionParams,
  ): [bigint, bigint] {
    const _slot0 = state.slot0;

    this._updatePosition(
      state,
      params.tickLower,
      params.tickUpper,
      params.liquidityDelta,
      _slot0.tick,
    );

    let amount0 = 0n;
    let amount1 = 0n;
    if (params.liquidityDelta !== 0n) {
      if (_slot0.tick < params.tickLower) {
        amount0 = SqrtPriceMath._getAmount0DeltaO(
          TickMath.getSqrtRatioAtTick(params.tickLower),
          TickMath.getSqrtRatioAtTick(params.tickUpper),
          params.liquidityDelta,
        );
      } else if (_slot0.tick < params.tickUpper) {
        const liquidityBefore = state.liquidity;

        [state.slot0.observationIndex, state.slot0.observationCardinality] =
          Oracle.write(
            state,
            _slot0.observationIndex,
            this._blockTimestamp(state),
            _slot0.tick,
            liquidityBefore,
            _slot0.observationCardinality,
            _slot0.observationCardinalityNext,
          );

        amount0 = SqrtPriceMath._getAmount0DeltaO(
          _slot0.sqrtPriceX96,
          TickMath.getSqrtRatioAtTick(params.tickUpper),
          params.liquidityDelta,
        );
        amount1 = SqrtPriceMath._getAmount1DeltaO(
          TickMath.getSqrtRatioAtTick(params.tickLower),
          _slot0.sqrtPriceX96,
          params.liquidityDelta,
        );

        state.liquidity = LiquidityMath.addDelta(
          liquidityBefore,
          params.liquidityDelta,
        );
      } else {
        amount1 = SqrtPriceMath._getAmount1DeltaO(
          TickMath.getSqrtRatioAtTick(params.tickLower),
          TickMath.getSqrtRatioAtTick(params.tickUpper),
          params.liquidityDelta,
        );
      }
    }
    return [amount0, amount1];
  }

  private _isTickToProcess(state: PoolState, tick: bigint): boolean {
    return tick >= state.lowestKnownTick && tick <= state.highestKnownTick;
  }

  private _updatePosition(
    state: PoolState,
    tickLower: bigint,
    tickUpper: bigint,
    liquidityDelta: bigint,
    tick: bigint,
  ): void {
    // if we need to update the ticks, do it
    let flippedLower = false;
    let flippedUpper = false;
    if (liquidityDelta !== 0n) {
      const time = this._blockTimestamp(state);
      const [tickCumulative, secondsPerLiquidityCumulativeX128] =
        Oracle.observeSingle(
          state,
          time,
          0n,
          state.slot0.tick,
          state.slot0.observationIndex,
          state.liquidity,
          state.slot0.observationCardinality,
        );

      if (this._isTickToProcess(state, tickLower)) {
        flippedLower = Tick.update(
          state,
          tickLower,
          tick,
          liquidityDelta,
          secondsPerLiquidityCumulativeX128,
          tickCumulative,
          time,
          false,
          state.maxLiquidityPerTick,
        );
      }
      if (this._isTickToProcess(state, tickUpper)) {
        flippedUpper = Tick.update(
          state,
          tickUpper,
          tick,
          liquidityDelta,
          secondsPerLiquidityCumulativeX128,
          tickCumulative,
          time,
          true,
          state.maxLiquidityPerTick,
        );
      }

      if (flippedLower) {
        TickBitMap.flipTick(state, tickLower, state.tickSpacing);
      }
      if (flippedUpper) {
        TickBitMap.flipTick(state, tickUpper, state.tickSpacing);
      }
    }

    // clear any tick data that is no longer needed
    if (liquidityDelta < 0n) {
      if (flippedLower) {
        Tick.clear(state, tickLower);
      }
      if (flippedUpper) {
        Tick.clear(state, tickUpper);
      }
    }
  }

  private _blockTimestamp(state: DeepReadonly<PoolState>) {
    return BigInt.asUintN(32, state.blockTimestamp);
  }
}

export const uniswapV3Math = new UniswapV3Math();
