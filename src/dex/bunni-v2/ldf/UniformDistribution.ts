import { hexlify } from 'ethers/lib/utils';

import { Q96 } from '../lib/Constants';
import { FullMathX96 } from '../lib/FullMathX96';
import { divUp, fullMulDiv, max, min, roundTickSingle } from '../lib/Math';
import { SqrtPriceMath } from '../lib/SqrtPriceMath';
import { TickMath } from '../lib/TickMath';
import { PoolKey } from '../types';
import { enforceShiftMode, ShiftMode } from './ShiftMode';

const INITIALIZED_STATE: bigint = 1n << 24n;

export abstract class UniformDistribution {
  static query(
    key: PoolKey,
    roundedTick: bigint,
    twapTick: bigint,
    spotPriceTick: bigint,
    ldfParams: string,
    ldfState: string,
  ): {
    liquidityDensityX96_: bigint;
    cumulativeAmount0DensityX96: bigint;
    cumulativeAmount1DensityX96: bigint;
    newLdfState: string;
    shouldSurge: boolean;
  } {
    let shouldSurge: boolean = false;

    let { tickLower, tickUpper, shiftMode } =
      LibUniformDistribution.decodeParams(twapTick, key.tickSpacing, ldfParams);
    const { initialized, lastTickLower } = this._decodeState(ldfState);
    if (initialized) {
      const tickLength = tickUpper - tickLower;
      tickLower = enforceShiftMode(tickLower, lastTickLower, shiftMode);
      tickUpper = tickLower + tickLength;
      shouldSurge = tickLower !== lastTickLower;
    }

    const {
      liquidityDensityX96_,
      cumulativeAmount0DensityX96,
      cumulativeAmount1DensityX96,
    } = LibUniformDistribution.query(
      roundedTick,
      key.tickSpacing,
      tickLower,
      tickUpper,
    );
    const newLdfState = this._encodeState(tickLower);

    return {
      liquidityDensityX96_,
      cumulativeAmount0DensityX96,
      cumulativeAmount1DensityX96,
      newLdfState,
      shouldSurge,
    };
  }

  static computeSwap(
    key: PoolKey,
    inverseCumulativeAmountInput: bigint,
    totalLiquidity: bigint,
    zeroForOne: boolean,
    exactIn: boolean,
    twapTick: bigint,
    spotPriceTick: bigint,
    ldfParams: string,
    ldfState: string,
  ): {
    success: boolean;
    roundedTick: bigint;
    cumulativeAmount0_: bigint;
    cumulativeAmount1_: bigint;
    swapLiquidity: bigint;
  } {
    let { tickLower, tickUpper, shiftMode } =
      LibUniformDistribution.decodeParams(twapTick, key.tickSpacing, ldfParams);
    const { initialized, lastTickLower } = this._decodeState(ldfState);
    if (initialized) {
      const tickLength = tickUpper - tickLower;
      tickLower = enforceShiftMode(tickLower, lastTickLower, shiftMode);
      tickUpper = tickLower + tickLength;
    }

    return LibUniformDistribution.computeSwap(
      inverseCumulativeAmountInput,
      totalLiquidity,
      zeroForOne,
      exactIn,
      key.tickSpacing,
      tickLower,
      tickUpper,
    );
  }

  static cumulativeAmount0(
    key: PoolKey,
    roundedTick: bigint,
    totalLiquidity: bigint,
    twapTick: bigint,
    spotPriceTick: bigint,
    ldfParams: string,
    ldfState: string,
  ): bigint {
    let { tickLower, tickUpper, shiftMode } =
      LibUniformDistribution.decodeParams(twapTick, key.tickSpacing, ldfParams);
    const { initialized, lastTickLower } = this._decodeState(ldfState);
    if (initialized) {
      const tickLength = tickUpper - tickLower;
      tickLower = enforceShiftMode(tickLower, lastTickLower, shiftMode);
      tickUpper = tickLower + tickLength;
    }

    return LibUniformDistribution.cumulativeAmount0(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      tickLower,
      tickUpper,
      false,
    );
  }

  static cumulativeAmount1(
    key: PoolKey,
    roundedTick: bigint,
    totalLiquidity: bigint,
    twapTick: bigint,
    spotPriceTick: bigint,
    ldfParams: string,
    ldfState: string,
  ): bigint {
    let { tickLower, tickUpper, shiftMode } =
      LibUniformDistribution.decodeParams(twapTick, key.tickSpacing, ldfParams);
    const { initialized, lastTickLower } = this._decodeState(ldfState);
    if (initialized) {
      const tickLength = tickUpper - tickLower;
      tickLower = enforceShiftMode(tickLower, lastTickLower, shiftMode);
      tickUpper = tickLower + tickLength;
    }

    return LibUniformDistribution.cumulativeAmount1(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      tickLower,
      tickUpper,
      false,
    );
  }

  static _decodeState(ldfState: string): {
    initialized: boolean;
    lastTickLower: bigint;
  } {
    const initialized: boolean =
      BigInt.asUintN(8, BigInt(`0x${ldfState.slice(2, 4)}`)) === 1n;
    const lastTickLower: bigint = BigInt.asIntN(
      24,
      BigInt.asUintN(24, BigInt(`0x${ldfState.slice(4, 10)}`)),
    );
    return { initialized, lastTickLower };
  }

  static _encodeState(lastTickLower: bigint): string {
    const lastTickLowerUnsigned = lastTickLower & 0xffffffn;
    const combined = INITIALIZED_STATE + lastTickLowerUnsigned;
    const hexCombined = hexlify(combined).slice(2);
    const paddedHex = hexCombined.padEnd(64, '0');
    return `0x${paddedHex}`;
  }
}

export abstract class LibUniformDistribution {
  static query(
    roundedTick: bigint,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
  ): {
    liquidityDensityX96_: bigint;
    cumulativeAmount0DensityX96: bigint;
    cumulativeAmount1DensityX96: bigint;
  } {
    let cumulativeAmount0DensityX96: bigint;
    let cumulativeAmount1DensityX96: bigint;

    const liquidityDensityX96_ = this.liquidityDensityX96(
      roundedTick,
      tickSpacing,
      tickLower,
      tickUpper,
    );

    const length = (tickUpper - tickLower) / tickSpacing;
    const liquidity = divUp(Q96, length);

    const sqrtRatioTickLower = TickMath.getSqrtPriceAtTick(tickLower);
    const sqrtRatioTickUpper = TickMath.getSqrtPriceAtTick(tickUpper);

    // compute cumulativeAmount0DensityX96
    if (roundedTick + tickSpacing >= tickUpper) {
      cumulativeAmount0DensityX96 = 0n;
    } else if (roundedTick + tickSpacing <= tickLower) {
      cumulativeAmount0DensityX96 = SqrtPriceMath.getAmount0Delta(
        sqrtRatioTickLower,
        sqrtRatioTickUpper,
        liquidity,
        true,
      );
    } else {
      cumulativeAmount0DensityX96 = SqrtPriceMath.getAmount0Delta(
        TickMath.getSqrtPriceAtTick(roundedTick + tickSpacing),
        sqrtRatioTickUpper,
        liquidity,
        true,
      );
    }

    if (roundedTick - tickSpacing < tickLower) {
      cumulativeAmount1DensityX96 = 0n;
    } else if (roundedTick >= tickUpper) {
      cumulativeAmount1DensityX96 = SqrtPriceMath.getAmount1Delta(
        sqrtRatioTickLower,
        sqrtRatioTickUpper,
        liquidity,
        true,
      );
    } else {
      cumulativeAmount1DensityX96 = SqrtPriceMath.getAmount1Delta(
        sqrtRatioTickLower,
        TickMath.getSqrtPriceAtTick(roundedTick),
        liquidity,
        true,
      );
    }

    return {
      liquidityDensityX96_,
      cumulativeAmount0DensityX96,
      cumulativeAmount1DensityX96,
    };
  }

  static cumulativeAmount0(
    roundedTick: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    isCarpet: boolean,
  ): bigint {
    if (roundedTick >= tickUpper || tickLower >= tickUpper) {
      return 0n;
    } else if (roundedTick < tickLower) {
      roundedTick = tickLower;
    }

    const length: bigint = (tickUpper - tickLower) / tickSpacing;
    const sqrtRatioTickUpper = TickMath.getSqrtPriceAtTick(tickUpper);

    return isCarpet
      ? SqrtPriceMath.getAmount0Delta(
          TickMath.getSqrtPriceAtTick(roundedTick),
          sqrtRatioTickUpper,
          divUp(totalLiquidity, length),
          true,
        )
      : FullMathX96.fullMulX96Up(
          totalLiquidity,
          SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(roundedTick),
            sqrtRatioTickUpper,
            divUp(Q96, length),
            true,
          ),
        );
  }

  static cumulativeAmount1(
    roundedTick: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    isCarpet: boolean,
  ): bigint {
    if (roundedTick < tickLower || tickLower >= tickUpper) {
      return 0n;
    } else if (roundedTick > tickUpper - tickSpacing) {
      roundedTick = tickUpper - tickSpacing;
    }

    const length = (tickUpper - tickLower) / tickSpacing;
    const sqrtRatioTickLower = TickMath.getSqrtPriceAtTick(tickLower);

    return isCarpet
      ? SqrtPriceMath.getAmount1Delta(
          sqrtRatioTickLower,
          TickMath.getSqrtPriceAtTick(roundedTick + tickSpacing),
          divUp(totalLiquidity, length),
          true,
        )
      : FullMathX96.fullMulX96Up(
          totalLiquidity,
          SqrtPriceMath.getAmount1Delta(
            sqrtRatioTickLower,
            TickMath.getSqrtPriceAtTick(roundedTick + tickSpacing),
            divUp(Q96, length),
            true,
          ),
        );
  }

  static inverseCumulativeAmount0(
    cumulativeAmount0_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    isCarpet: boolean,
  ): { success: boolean; roundedTick: bigint } {
    if (cumulativeAmount0_ === 0n)
      return { success: true, roundedTick: tickUpper };

    let success: boolean = false;
    let roundedTick: bigint = 0n;

    const length = (tickUpper - tickLower) / tickSpacing;

    const sqrtRatioTickLower = TickMath.getSqrtPriceAtTick(tickLower);
    const sqrtRatioTickUpper = TickMath.getSqrtPriceAtTick(tickUpper);
    const sqrtPrice = isCarpet
      ? SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp(
          sqrtRatioTickUpper,
          divUp(totalLiquidity, length),
          cumulativeAmount0_,
          true,
        )
      : SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp(
          sqrtRatioTickUpper,
          divUp(Q96, length),
          fullMulDiv(cumulativeAmount0_, Q96, totalLiquidity),
          true,
        );

    if (sqrtPrice < sqrtRatioTickLower) {
      return { success: false, roundedTick: 0n };
    }

    const tick = TickMath.getTickAtSqrtPrice(sqrtPrice);
    success = true;
    roundedTick = roundTickSingle(tick, tickSpacing);

    if (roundedTick < tickLower || roundedTick > tickUpper) {
      return { success: false, roundedTick: 0n };
    }

    if (roundedTick === tickUpper) {
      return { success: true, roundedTick: tickUpper - tickSpacing };
    }

    return { success, roundedTick };
  }

  static inverseCumulativeAmount1(
    cumulativeAmount1_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    isCarpet: boolean,
  ): { success: boolean; roundedTick: bigint } {
    if (cumulativeAmount1_ === 0n)
      return { success: true, roundedTick: tickLower - tickSpacing };

    let success: boolean = false;
    let roundedTick: bigint = 0n;

    const length = (tickUpper - tickLower) / tickSpacing;

    const sqrtRatioTickLower = TickMath.getSqrtPriceAtTick(tickLower);
    const sqrtRatioTickUpper = TickMath.getSqrtPriceAtTick(tickUpper);
    const sqrtPrice = isCarpet
      ? SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown(
          sqrtRatioTickLower,
          divUp(totalLiquidity, length),
          cumulativeAmount1_,
          true,
        )
      : SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown(
          sqrtRatioTickLower,
          divUp(Q96, length),
          fullMulDiv(cumulativeAmount1_, Q96, totalLiquidity),
          true,
        );

    if (sqrtPrice > sqrtRatioTickUpper) {
      return { success: false, roundedTick: 0n };
    }

    let tick = TickMath.getTickAtSqrtPrice(sqrtPrice);
    if (tick === tickUpper) tick -= 1n;
    success = true;
    roundedTick = roundTickSingle(tick, tickSpacing);

    if (roundedTick < tickLower - tickSpacing || roundedTick >= tickUpper) {
      return { success: false, roundedTick: 0n };
    }

    if (roundedTick === tickLower - tickSpacing) {
      return { success: true, roundedTick: tickLower };
    }

    return { success, roundedTick };
  }

  static liquidityDensityX96(
    roundedTick: bigint,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
  ): bigint {
    if (roundedTick < tickLower || roundedTick >= tickUpper) {
      return 0n;
    }
    const length = (tickUpper - tickLower) / tickSpacing;
    return Q96 / length;
  }

  static computeSwap(
    inverseCumulativeAmountInput: bigint,
    totalLiquidity: bigint,
    zeroForOne: boolean,
    exactIn: boolean,
    tickSpacing: bigint,
    tickLower: bigint,
    tickUpper: bigint,
  ): {
    success: boolean;
    roundedTick: bigint;
    cumulativeAmount0_: bigint;
    cumulativeAmount1_: bigint;
    swapLiquidity: bigint;
  } {
    let success: boolean = false;
    let roundedTick: bigint = 0n;
    let cumulativeAmount0_: bigint = 0n;
    let cumulativeAmount1_: bigint = 0n;
    let swapLiquidity: bigint = 0n;

    if (exactIn === zeroForOne) {
      ({ success, roundedTick } = this.inverseCumulativeAmount0(
        inverseCumulativeAmountInput,
        totalLiquidity,
        tickSpacing,
        tickLower,
        tickUpper,
        false,
      ));

      if (!success) {
        return {
          success: false,
          roundedTick: 0n,
          cumulativeAmount0_: 0n,
          cumulativeAmount1_: 0n,
          swapLiquidity: 0n,
        };
      }

      cumulativeAmount0_ = exactIn
        ? this.cumulativeAmount0(
            roundedTick + tickSpacing,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          )
        : this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          );

      cumulativeAmount1_ = exactIn
        ? this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          )
        : this.cumulativeAmount1(
            roundedTick - tickSpacing,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          tickLower,
          tickUpper,
        ) *
          totalLiquidity) >>
        96n;

      return {
        success,
        roundedTick,
        cumulativeAmount0_,
        cumulativeAmount1_,
        swapLiquidity,
      };
    } else {
      ({ success, roundedTick } = this.inverseCumulativeAmount1(
        inverseCumulativeAmountInput,
        totalLiquidity,
        tickSpacing,
        tickLower,
        tickUpper,
        false,
      ));

      if (!success) {
        return {
          success: false,
          roundedTick: 0n,
          cumulativeAmount0_: 0n,
          cumulativeAmount1_: 0n,
          swapLiquidity: 0n,
        };
      }

      cumulativeAmount1_ = exactIn
        ? this.cumulativeAmount1(
            roundedTick - tickSpacing,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          )
        : this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          );

      cumulativeAmount0_ = exactIn
        ? this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          )
        : this.cumulativeAmount0(
            roundedTick + tickSpacing,
            totalLiquidity,
            tickSpacing,
            tickLower,
            tickUpper,
            false,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          tickLower,
          tickUpper,
        ) *
          totalLiquidity) >>
        96n;

      return {
        success,
        roundedTick,
        cumulativeAmount0_,
        cumulativeAmount1_,
        swapLiquidity,
      };
    }
  }

  static decodeParams(
    twapTick: bigint,
    tickSpacing: bigint,
    ldfParams: string,
  ): { tickLower: bigint; tickUpper: bigint; shiftMode: ShiftMode } {
    const shiftMode: number = Number(
      BigInt.asUintN(8, BigInt(`0x${ldfParams.slice(2, 4)}`)),
    );
    let tickLower: bigint;
    let tickUpper: bigint;

    if (shiftMode !== ShiftMode.STATIC) {
      const offset: bigint = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(4, 10)}`)),
      );
      const length: bigint = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(10, 16)}`)),
      );
      tickLower = roundTickSingle(twapTick + offset, tickSpacing);
      tickUpper = tickLower + length * tickSpacing;

      const minUsableTick = TickMath.minUsableTick(tickSpacing);
      const maxUsableTick = TickMath.maxUsableTick(tickSpacing);

      if (tickLower < minUsableTick) {
        const tickLength = tickUpper - tickLower;
        tickLower = minUsableTick;
        tickUpper = min(tickLower + tickLength, maxUsableTick);
      } else if (tickUpper > maxUsableTick) {
        const tickLength = tickUpper - tickLower;
        tickUpper = maxUsableTick;
        tickLower = max(tickUpper - tickLength, minUsableTick);
      }
    } else {
      tickLower = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(4, 10)}`)),
      );
      tickUpper = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(10, 16)}`)),
      );
    }

    return { tickLower, tickUpper, shiftMode };
  }
}
