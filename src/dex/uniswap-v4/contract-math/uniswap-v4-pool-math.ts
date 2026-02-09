import { PoolState, ModifyLiquidityParams, Pool } from '../types';
import { TickMath } from './TickMath';
import { TickBitMap } from './TickBitMap';
import { Tick } from './Tick';
import { _require } from '../../../utils';
import { LiquidityMath } from './LiquidityMath';
import { SqrtPriceMath } from './SqrtPriceMath';
import { UnsafeMath } from './UnsafeMath';
import { FixedPoint128 } from './FixedPoint128';
import { ProtocolFeeLibrary } from './ProtocolFeeLibrary';
import { SwapMath } from './SwapMath';
import { BalanceDelta, toBalanceDelta } from './BalanceDelta';
import { DeepReadonly } from 'ts-essentials';
import { SwapSide } from '@paraswap/core';
import {
  MAX_PRICING_COMPUTATION_STEPS_ALLOWED,
  SWAP_EVENT_MAX_CYCLES,
} from '../constants';
import { LPFeeLibrary } from './LPFeeLibrary';
import { Logger } from 'log4js';
import { IBaseHook } from '../hooks/types';
import { NULL_ADDRESS } from '../../../constants';

type StepComputations = {
  sqrtPriceStartX96: bigint;
  tickNext: bigint;
  initialized: boolean;
  sqrtPriceNextX96: bigint;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  feeGrowthGlobalX128: bigint;
};

type SwapParams = {
  amountSpecified: bigint;
  tickSpacing: bigint;
  zeroForOne: boolean;
  sqrtPriceLimitX96: bigint;
  lpFeeOverride: bigint;
};

class UniswapV4PoolMath {
  public queryOutputs(
    pool: Pool,
    poolState: DeepReadonly<PoolState>,
    amounts: bigint[],
    zeroForOne: boolean,
    side: SwapSide,
    hook?: IBaseHook,
  ): bigint[] {
    const isSell = side === SwapSide.SELL;

    if (isSell) {
      return amounts.map(amount => {
        if (amount === 0n) {
          return 0n;
        }

        const sqrtPriceLimitX96 = zeroForOne
          ? TickMath.MIN_SQRT_PRICE + 1n
          : TickMath.MAX_SQRT_PRICE - 1n;

        const amountSpecified = -amount;
        const [amount0, amount1] = this._swap(poolState, {
          zeroForOne,
          amountSpecified,
          tickSpacing: BigInt(pool.key.tickSpacing),
          sqrtPriceLimitX96,
          lpFeeOverride: 0n,
        } as SwapParams);

        const amountSpecifiedActual =
          zeroForOne === amountSpecified < 0n ? amount0 : amount1;

        if (amountSpecifiedActual !== amountSpecified) {
          return 0n;
        }

        let output = zeroForOne ? amount1 : amount0;

        if (hook?.getHookPermissions().afterSwap) {
          output = hook.afterSwap!(
            NULL_ADDRESS,
            pool.key,
            {
              zeroForOne,
              amountSpecified: amountSpecified.toString(),
              sqrtPriceLimitX96: sqrtPriceLimitX96.toString(),
            },
            { amount0, amount1 },
            '0x',
          );
        }

        return output;
      });
    } else {
      return amounts.map(amount => {
        if (amount === 0n) {
          return 0n;
        }

        const sqrtPriceLimitX96 = zeroForOne
          ? TickMath.MIN_SQRT_PRICE + 1n
          : TickMath.MAX_SQRT_PRICE - 1n;

        const amountSpecified = amount;
        const [amount0, amount1] = this._swap(poolState, {
          zeroForOne,
          amountSpecified: amount,
          tickSpacing: BigInt(pool.key.tickSpacing),
          sqrtPriceLimitX96,
          lpFeeOverride: 0n,
        } as SwapParams);

        const amountSpecifiedActual =
          zeroForOne === amountSpecified < 0n ? amount0 : amount1;

        if (amountSpecifiedActual !== amountSpecified) {
          return 0n;
        }

        let output = zeroForOne ? -amount0 : -amount1;

        if (hook?.getHookPermissions().afterSwap) {
          output = hook.afterSwap!(
            NULL_ADDRESS,
            pool.key,
            {
              zeroForOne,
              amountSpecified: amountSpecified.toString(),
              sqrtPriceLimitX96: sqrtPriceLimitX96.toString(),
            },
            { amount0, amount1 },
            '0x',
          );
        }

        return output;
      });
    }
  }

  _swap(poolState: PoolState, params: SwapParams): [bigint, bigint] {
    const slot0Start = poolState.slot0;
    const zeroForOne = params.zeroForOne;

    const protocolFee = zeroForOne
      ? ProtocolFeeLibrary.getZeroForOneFee(BigInt(slot0Start.protocolFee))
      : ProtocolFeeLibrary.getOneForZeroFee(BigInt(slot0Start.protocolFee));

    let amountSpecifiedRemaining = params.amountSpecified;
    let amountCalculated = 0n;

    let result = {
      sqrtPriceX96: slot0Start.sqrtPriceX96,
      liquidity: poolState.liquidity,
      tick: slot0Start.tick,
    };

    const lpFee = LPFeeLibrary.isOverride(params.lpFeeOverride)
      ? LPFeeLibrary.removeOverrideFlag(params.lpFeeOverride)
      : slot0Start.lpFee;

    const swapFee =
      protocolFee === 0n
        ? lpFee
        : ProtocolFeeLibrary.calculateSwapFee(protocolFee, lpFee);

    if (swapFee >= SwapMath.MAX_SWAP_FEE) {
      _require(
        params.amountSpecified < 0n,
        'Invalid fee for exact out',
        { amountSpecified: params.amountSpecified },
        'params.amountSpecified < 0n',
      );
    }

    if (params.amountSpecified === 0n) {
      return [BalanceDelta.ZERO_DELTA, BalanceDelta.ZERO_DELTA];
    }

    if (zeroForOne) {
      _require(
        params.sqrtPriceLimitX96 < slot0Start.sqrtPriceX96,
        'Price limit already exceeded',
        {
          sqrtPriceLimitX96: params.sqrtPriceLimitX96,
          sqrtPriceX96: slot0Start.sqrtPriceX96,
        },
        'params.sqrtPriceLimitX96 < slot0Start.sqrtPriceX96',
      );

      _require(
        params.sqrtPriceLimitX96 > TickMath.MIN_SQRT_PRICE,
        'Price limit out of bounds',
        {
          sqrtPriceLimitX96: params.sqrtPriceLimitX96,
          minSqrtPrice: TickMath.MIN_SQRT_PRICE,
        },
        'params.sqrtPriceLimitX96 > TickMath.MIN_SQRT_PRICE',
      );
    } else {
      _require(
        params.sqrtPriceLimitX96 > slot0Start.sqrtPriceX96,
        'Price limit already exceeded',
        {
          sqrtPriceLimitX96: params.sqrtPriceLimitX96,
          sqrtPriceX96: slot0Start.sqrtPriceX96,
        },
        'params.sqrtPriceLimitX96 > slot0Start.sqrtPriceX96',
      );

      _require(
        params.sqrtPriceLimitX96 < TickMath.MAX_SQRT_PRICE,
        'Price limit out of bounds',
        {
          sqrtPriceLimitX96: params.sqrtPriceLimitX96,
          minSqrtPrice: TickMath.MIN_SQRT_PRICE,
        },
        'params.sqrtPriceLimitX96 < TickMath.MAX_SQRT_PRICE',
      );
    }

    let step = {
      feeGrowthGlobalX128: zeroForOne
        ? poolState.feeGrowthGlobal0X128
        : poolState.feeGrowthGlobal1X128,
      feeAmount: 0n,
      sqrtPriceStartX96: 0n,
      sqrtPriceNextX96: 0n,
      amountIn: 0n,
      amountOut: 0n,
    } as StepComputations;

    let counter = 0;
    while (
      !(
        amountSpecifiedRemaining === 0n ||
        result.sqrtPriceX96 === params.sqrtPriceLimitX96
      ) &&
      counter <= MAX_PRICING_COMPUTATION_STEPS_ALLOWED
    ) {
      step.sqrtPriceStartX96 = result.sqrtPriceX96;

      const [next, initialized] = TickBitMap.nextInitializedTickWithinOneWord(
        poolState,
        result.tick,
        params.tickSpacing,
        zeroForOne,
      );
      step.tickNext = next;
      step.initialized = initialized;

      if (step.tickNext <= TickMath.MIN_TICK) {
        step.tickNext = TickMath.MIN_TICK;
      }

      if (step.tickNext >= TickMath.MAX_TICK) {
        step.tickNext = TickMath.MAX_TICK;
      }

      step.sqrtPriceNextX96 = TickMath.getSqrtPriceAtTick(step.tickNext);

      const {
        sqrtPriceNextX96: resultSqrtPriceNextX96,
        amountIn: stepAmountIn,
        amountOut: stepAmountOut,
        feeAmount: stepFeeAmount,
      } = SwapMath.computeSwapStep(
        result.sqrtPriceX96,
        SwapMath.getSqrtPriceTarget(
          zeroForOne,
          step.sqrtPriceNextX96,
          params.sqrtPriceLimitX96,
        ),
        result.liquidity,
        amountSpecifiedRemaining,
        swapFee,
      );

      result.sqrtPriceX96 = resultSqrtPriceNextX96;
      step.amountIn = stepAmountIn;
      step.amountOut = stepAmountOut;
      step.feeAmount = stepFeeAmount;

      if (params.amountSpecified > 0n) {
        amountSpecifiedRemaining -= step.amountOut;
        amountCalculated -= step.amountIn + step.feeAmount;
      } else {
        amountSpecifiedRemaining += step.amountIn + step.feeAmount;
        amountCalculated += step.amountOut;
      }

      if (protocolFee > 0) {
        const delta =
          swapFee === protocolFee
            ? step.feeAmount
            : ((step.amountIn + step.feeAmount) * BigInt(protocolFee)) /
              ProtocolFeeLibrary.PIPS_DENOMINATOR;
        step.feeAmount -= delta;
      }

      if (result.liquidity > 0) {
        step.feeGrowthGlobalX128 += UnsafeMath.simpleMulDiv(
          step.feeAmount,
          FixedPoint128.Q128,
          result.liquidity,
        );
      }

      if (result.sqrtPriceX96 === step.sqrtPriceNextX96) {
        if (step.initialized) {
          let liquidityNet = Tick.cross(poolState.ticks, step.tickNext);

          if (zeroForOne) {
            liquidityNet = -liquidityNet;
          }

          result.liquidity = LiquidityMath.addDelta(
            result.liquidity,
            liquidityNet,
          );
        }

        result.tick = zeroForOne ? step.tickNext - 1n : step.tickNext;
      } else if (result.sqrtPriceX96 !== step.sqrtPriceStartX96) {
        result.tick = TickMath.getTickAtSqrtPrice(result.sqrtPriceX96);
      }

      counter++;
    }

    if (counter >= MAX_PRICING_COMPUTATION_STEPS_ALLOWED) {
      return [0n, 0n];
    }

    if (zeroForOne !== params.amountSpecified < 0) {
      return [
        amountCalculated,
        params.amountSpecified - amountSpecifiedRemaining,
      ];
    } else {
      return [
        params.amountSpecified - amountSpecifiedRemaining,
        amountCalculated,
      ];
    }
  }

  tickSpacingToMaxLiquidityPerTick(tickSpacing: bigint) {
    const MAX_TICK = TickMath.MAX_TICK;
    const MIN_TICK = TickMath.MIN_TICK;

    _require(
      tickSpacing >= 0n,
      'tickSpacing must be a positive integer.',
      { tickSpacing },
      'tickSpacing >= 0n',
    );

    let minTick = Math.floor(Number(MIN_TICK / tickSpacing));
    if (MIN_TICK % tickSpacing !== 0n) {
      minTick--;
    }

    const maxTick = Math.floor(Number(MAX_TICK / tickSpacing));
    const numTicks = BigInt(maxTick - minTick) + 1n;
    const MAX_UINT128 = (1n << 128n) - 1n;

    return MAX_UINT128 / numTicks;
  }

  checkPoolInitialized(poolState: PoolState) {
    const { sqrtPriceX96 } = poolState.slot0;
    _require(
      sqrtPriceX96 !== 0n,
      '',
      { sqrtPriceX96 },
      `Pool ${poolState.id} is not initialized`,
    );
  }

  modifyLiquidity(
    poolState: PoolState,
    {
      liquidityDelta,
      tickLower,
      tickUpper,
      tickSpacing,
    }: ModifyLiquidityParams,
  ) {
    Tick.check(tickLower, tickUpper);

    let flippedLower: boolean = false;
    let flippedUpper: boolean = false;

    if (liquidityDelta !== 0n) {
      const {
        flipped: flippedLowerVal,
        liquidityGrossAfter: liquidityGrossAfterLower,
      } = Tick.update(poolState, tickLower, liquidityDelta, false);

      flippedLower = flippedLowerVal;

      const {
        flipped: flippedUpperVal,
        liquidityGrossAfter: liquidityGrossAfterUpper,
      } = Tick.update(poolState, tickUpper, liquidityDelta, true);

      flippedUpper = flippedUpperVal;

      if (liquidityDelta >= 0n) {
        const maxLiquidityPerTick = this.tickSpacingToMaxLiquidityPerTick(
          BigInt(tickSpacing),
        );

        _require(
          liquidityGrossAfterLower < maxLiquidityPerTick,
          '',
          { liquidityGrossAfterLower, maxLiquidityPerTick },
          'liquidityGrossAfterLower < maxLiquidityPerTick',
        );

        _require(
          liquidityGrossAfterUpper < maxLiquidityPerTick,
          '',
          { liquidityGrossAfterUpper, maxLiquidityPerTick },
          'liquidityGrossAfterUpper < maxLiquidityPerTick',
        );
      }

      if (flippedLower) {
        TickBitMap.flipTick(
          poolState,
          tickLower,
          BigInt(poolState.tickSpacing),
        );
      }

      if (flippedUpper) {
        TickBitMap.flipTick(
          poolState,
          tickUpper,
          BigInt(poolState.tickSpacing),
        );
      }
    }

    if (liquidityDelta < 0n) {
      if (flippedLower) {
        Tick.clear(poolState, tickLower);
      }
      if (flippedUpper) {
        Tick.clear(poolState, tickUpper);
      }
    }

    if (liquidityDelta !== 0n) {
      const slot0 = poolState.slot0!;
      const { tick, sqrtPriceX96 } = slot0;

      let delta: bigint;
      if (BigInt(tick) < tickLower) {
        delta = toBalanceDelta(
          SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityDelta,
            false,
          ),
          0n,
        );
      } else if (BigInt(tick) < tickUpper) {
        delta = toBalanceDelta(
          SqrtPriceMath.getAmount0Delta(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityDelta,
            false,
          ),
          SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(tickLower),
            sqrtPriceX96,
            liquidityDelta,
            false,
          ),
        );

        poolState.liquidity = LiquidityMath.addDelta(
          poolState.liquidity!,
          liquidityDelta,
        );
      } else {
        delta = toBalanceDelta(
          0n,
          SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityDelta,
            false,
          ),
        );
      }

      return { delta };
    }
  }

  setProtocolFee(poolState: PoolState, protocolFee: bigint): void {
    poolState.slot0.lpFee = protocolFee;
  }

  donate(poolState: PoolState, amount0: bigint, amount1: bigint): bigint {
    const liquidity = poolState.liquidity!;
    _require(liquidity !== 0n, '', { liquidity }, 'liquidity !== 0n');

    const delta = toBalanceDelta(-amount0, -amount1);

    if (amount0 > 0n) {
      poolState.feeGrowthGlobal0X128 += UnsafeMath.simpleMulDiv(
        amount0,
        FixedPoint128.Q128,
        liquidity,
      );
    }

    if (amount1 > 0n) {
      poolState.feeGrowthGlobal1X128 += UnsafeMath.simpleMulDiv(
        amount1,
        FixedPoint128.Q128,
        liquidity,
      );
    }

    return delta;
  }

  swapFromEvent(
    poolState: PoolState,
    zeroForOne: boolean,
    newSqrtPriceX96: bigint,
    newTick: bigint,
    newLiquidity: bigint,
    newSwapFee: bigint,
    amount0: bigint,
    amount1: bigint,
    logger: Logger,
  ) {
    const slot0Start = poolState.slot0;

    const protocolFee = zeroForOne
      ? ProtocolFeeLibrary.getZeroForOneFee(slot0Start.protocolFee)
      : ProtocolFeeLibrary.getOneForZeroFee(slot0Start.protocolFee);

    const amountSpecified = zeroForOne ? amount0 : amount1;
    let amountSpecifiedRemaining = amountSpecified;
    let amountCalculated = 0n;

    let result = {
      sqrtPriceX96: slot0Start.sqrtPriceX96,
      liquidity: poolState.liquidity,
      tick: slot0Start.tick,
    };

    const lpFee = slot0Start.lpFee;
    const swapFee =
      protocolFee === 0n
        ? lpFee
        : ProtocolFeeLibrary.calculateSwapFee(protocolFee, lpFee);

    const paramsTickSpacing = poolState.tickSpacing;
    const paramsSqrtPriceLimitX96 = newSqrtPriceX96;

    let step = {
      feeGrowthGlobalX128: zeroForOne
        ? poolState.feeGrowthGlobal0X128
        : poolState.feeGrowthGlobal1X128,
      feeAmount: 0n,
      sqrtPriceStartX96: 0n,
      sqrtPriceNextX96: 0n,
      amountIn: 0n,
      amountOut: 0n,
    } as StepComputations;

    let counter = 0;
    while (
      !(
        amountSpecifiedRemaining === 0n ||
        result.sqrtPriceX96 === paramsSqrtPriceLimitX96
      ) &&
      counter < SWAP_EVENT_MAX_CYCLES
    ) {
      step.sqrtPriceStartX96 = result.sqrtPriceX96;

      const [next, initialized] = TickBitMap.nextInitializedTickWithinOneWord(
        poolState,
        BigInt(result.tick),
        BigInt(paramsTickSpacing),
        zeroForOne,
      );

      step.tickNext = next;
      step.initialized = initialized;

      if (step.tickNext <= TickMath.MIN_TICK) {
        step.tickNext = TickMath.MIN_TICK;
      }

      if (step.tickNext >= TickMath.MAX_TICK) {
        step.tickNext = TickMath.MAX_TICK;
      }

      step.sqrtPriceNextX96 = TickMath.getSqrtPriceAtTick(step.tickNext);

      const {
        sqrtPriceNextX96: resultSqrtPriceNextX96,
        amountIn: stepAmountIn,
        amountOut: stepAmountOut,
        feeAmount: stepFeeAmount,
      } = SwapMath.computeSwapStep(
        result.sqrtPriceX96,
        SwapMath.getSqrtPriceTarget(
          zeroForOne,
          step.sqrtPriceNextX96,
          paramsSqrtPriceLimitX96,
        ),
        result.liquidity,
        amountSpecifiedRemaining,
        BigInt(swapFee),
      );

      result.sqrtPriceX96 = resultSqrtPriceNextX96;

      step.amountIn = stepAmountIn;
      step.amountOut = stepAmountOut;
      step.feeAmount = stepFeeAmount;

      if (amountSpecified > 0n) {
        amountSpecifiedRemaining -= step.amountOut;
        amountCalculated -= step.amountIn + step.feeAmount;
      } else {
        amountSpecifiedRemaining += step.amountIn + step.feeAmount;
        amountCalculated += step.amountOut;
      }

      if (protocolFee > 0) {
        const delta =
          swapFee === protocolFee
            ? step.feeAmount
            : ((step.amountIn + step.feeAmount) * BigInt(protocolFee)) /
              BigInt(ProtocolFeeLibrary.PIPS_DENOMINATOR);
        step.feeAmount -= delta;
      }

      if (result.liquidity > 0n) {
        step.feeGrowthGlobalX128 += UnsafeMath.simpleMulDiv(
          step.feeAmount,
          FixedPoint128.Q128,
          result.liquidity,
        );
      }

      if (result.sqrtPriceX96 === step.sqrtPriceNextX96) {
        if (step.initialized) {
          let liquidityNet = Tick.cross(poolState.ticks, step.tickNext);

          if (zeroForOne) {
            liquidityNet = -liquidityNet;
          }

          result.liquidity = LiquidityMath.addDelta(
            result.liquidity,
            liquidityNet,
          );
        }

        result.tick = zeroForOne ? step.tickNext - 1n : step.tickNext;
      } else if (result.sqrtPriceX96 !== step.sqrtPriceStartX96) {
        result.tick = TickMath.getTickAtSqrtPrice(result.sqrtPriceX96);
      }

      counter++;
    }

    if (counter >= SWAP_EVENT_MAX_CYCLES) {
      logger.info(
        `Swap event (amount0: ${amount0}, amount1: ${amount1}, newSqrtPriceX96: ${newSqrtPriceX96}, newTick: ${newTick}, newLiquidity: ${newLiquidity}, newSwapFee: ${newSwapFee}) max cycles are reached  ${counter} for pool: ${poolState.id}`,
      );
    }

    const currentTick = result.tick;
    const currentPrice = result.sqrtPriceX96;

    _require(
      currentPrice === newSqrtPriceX96 && currentTick === newTick,
      'LOGIC ERROR: calculated (currentPrice,currentTick) and (newSqrtPriceX96, newTick) from event should always be equal at the end',
      { currentPrice, newSqrtPriceX96, currentTick, newTick },
      'currentPrice === newSqrtPriceX96 && currentTick === newTick',
    );

    poolState.slot0.tick = newTick;
    poolState.slot0.sqrtPriceX96 = newSqrtPriceX96;

    if (poolState.liquidity !== result.liquidity) {
      poolState.liquidity = result.liquidity;
    }

    if (!zeroForOne) {
      poolState.feeGrowthGlobal1X128 = step.feeGrowthGlobalX128;
    } else {
      poolState.feeGrowthGlobal0X128 = step.feeGrowthGlobalX128;
    }
  }
}

export const uniswapV4PoolMath = new UniswapV4PoolMath();
