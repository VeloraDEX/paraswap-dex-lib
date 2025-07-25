import { hexlify } from 'ethers/lib/utils';
import { PoolKey } from '../types';
import { enforceShiftMode, ShiftMode } from './ShiftMode';
import { Q96 } from '../lib/Constants';
import { LibGeometricDistribution } from './GeometricDistribution';
import { mulDiv, roundTickSingle, weightedSum } from '../lib/Math';
import { TickMath } from '../lib/TickMath';

const INITIALIZED_STATE: bigint = 1n << 24n;

export abstract class DoubleGeometricDistribution {
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

    let {
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
      shiftMode,
    } = LibDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
      shouldSurge = minTick !== lastMinTick;
    }

    const {
      liquidityDensityX96_,
      cumulativeAmount0DensityX96,
      cumulativeAmount1DensityX96,
    } = LibDoubleGeometricDistribution.query(
      roundedTick,
      key.tickSpacing,
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
    );
    const newLdfState = this._encodeState(minTick);

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
    let {
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
      shiftMode,
    } = LibDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibDoubleGeometricDistribution.computeSwap(
      inverseCumulativeAmountInput,
      totalLiquidity,
      zeroForOne,
      exactIn,
      key.tickSpacing,
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
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
    let {
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
      shiftMode,
    } = LibDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibDoubleGeometricDistribution.cumulativeAmount0(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
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
    let {
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
      shiftMode,
    } = LibDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibDoubleGeometricDistribution.cumulativeAmount1(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
    );
  }

  static _decodeState(ldfState: string): {
    initialized: boolean;
    lastMinTick: bigint;
  } {
    const initialized: boolean =
      BigInt.asUintN(8, BigInt(`0x${ldfState.slice(2, 4)}`)) === 1n;
    const lastMinTick: bigint = BigInt.asIntN(
      24,
      BigInt.asUintN(24, BigInt(`0x${ldfState.slice(4, 10)}`)),
    );
    return { initialized, lastMinTick };
  }

  static _encodeState(lastMinTick: bigint): string {
    const lastMinTickUnsigned = lastMinTick & 0xffffffn;
    const combined = INITIALIZED_STATE + lastMinTickUnsigned;
    const hexCombined = hexlify(combined).slice(2);
    const paddedHex = hexCombined.padEnd(64, '0');
    return `0x${paddedHex}`;
  }
}

const ALPHA_BASE: bigint = 100_000_000n;

export abstract class LibDoubleGeometricDistribution {
  static query(
    roundedTick: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
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
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
    );

    cumulativeAmount0DensityX96 = this.cumulativeAmount0(
      roundedTick + tickSpacing,
      Q96,
      tickSpacing,
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
    );

    cumulativeAmount1DensityX96 = this.cumulativeAmount1(
      roundedTick - tickSpacing,
      Q96,
      tickSpacing,
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
    );

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
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
  ): bigint {
    const totalLiquidity0 = mulDiv(totalLiquidity, weight0, weight0 + weight1);
    const totalLiquidity1 = mulDiv(totalLiquidity, weight1, weight0 + weight1);
    const amount0 =
      LibGeometricDistribution.cumulativeAmount0(
        roundedTick,
        totalLiquidity0,
        tickSpacing,
        minTick + length1 * tickSpacing,
        length0,
        alpha0X96,
      ) +
      LibGeometricDistribution.cumulativeAmount0(
        roundedTick,
        totalLiquidity1,
        tickSpacing,
        minTick,
        length1,
        alpha1X96,
      );
    return amount0;
  }

  static cumulativeAmount1(
    roundedTick: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
  ): bigint {
    const totalLiquidity0 = mulDiv(totalLiquidity, weight0, weight0 + weight1);
    const totalLiquidity1 = mulDiv(totalLiquidity, weight1, weight0 + weight1);
    const amount1 =
      LibGeometricDistribution.cumulativeAmount1(
        roundedTick,
        totalLiquidity0,
        tickSpacing,
        minTick + length1 * tickSpacing,
        length0,
        alpha0X96,
      ) +
      LibGeometricDistribution.cumulativeAmount1(
        roundedTick,
        totalLiquidity1,
        tickSpacing,
        minTick,
        length1,
        alpha1X96,
      );
    return amount1;
  }

  static inverseCumulativeAmount0(
    cumulativeAmount0_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
  ): { success: boolean; roundedTick: bigint } {
    const minTick0 = minTick + length1 * tickSpacing;
    const totalLiquidity0 = mulDiv(totalLiquidity, weight0, weight0 + weight1);
    const ldf0CumulativeAmount0 = LibGeometricDistribution.cumulativeAmount0(
      minTick0,
      totalLiquidity0,
      tickSpacing,
      minTick0,
      length0,
      alpha0X96,
    );

    if (cumulativeAmount0_ <= ldf0CumulativeAmount0) {
      return LibGeometricDistribution.inverseCumulativeAmount0(
        cumulativeAmount0_,
        totalLiquidity0,
        tickSpacing,
        minTick0,
        length0,
        alpha0X96,
      );
    } else {
      const remainder = cumulativeAmount0_ - ldf0CumulativeAmount0;
      const totalLiquidity1 = mulDiv(
        totalLiquidity,
        weight1,
        weight0 + weight1,
      );
      return LibGeometricDistribution.inverseCumulativeAmount0(
        remainder,
        totalLiquidity1,
        tickSpacing,
        minTick,
        length1,
        alpha1X96,
      );
    }
  }

  static inverseCumulativeAmount1(
    cumulativeAmount1_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
  ): { success: boolean; roundedTick: bigint } {
    const totalLiquidity1 = mulDiv(totalLiquidity, weight1, weight0 + weight1);
    const ldf1CumulativeAmount1 = LibGeometricDistribution.cumulativeAmount1(
      minTick + length1 * tickSpacing,
      totalLiquidity1,
      tickSpacing,
      minTick,
      length1,
      alpha1X96,
    );

    if (cumulativeAmount1_ <= ldf1CumulativeAmount1) {
      return LibGeometricDistribution.inverseCumulativeAmount1(
        cumulativeAmount1_,
        totalLiquidity1,
        tickSpacing,
        minTick,
        length1,
        alpha1X96,
      );
    } else {
      const remainder = cumulativeAmount1_ - ldf1CumulativeAmount1;
      const totalLiquidity0 = mulDiv(
        totalLiquidity,
        weight0,
        weight0 + weight1,
      );
      return LibGeometricDistribution.inverseCumulativeAmount1(
        remainder,
        totalLiquidity0,
        tickSpacing,
        minTick + length1 * tickSpacing,
        length0,
        alpha0X96,
      );
    }
  }

  static liquidityDensityX96(
    roundedTick: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
  ): bigint {
    return weightedSum(
      LibGeometricDistribution.liquidityDensityX96(
        roundedTick,
        tickSpacing,
        minTick + length1 * tickSpacing,
        length0,
        alpha0X96,
      ),
      weight0,
      LibGeometricDistribution.liquidityDensityX96(
        roundedTick,
        tickSpacing,
        minTick,
        length1,
        alpha1X96,
      ),
      weight1,
    );
  }

  static computeSwap(
    inverseCumulativeAmountInput: bigint,
    totalLiquidity: bigint,
    zeroForOne: boolean,
    exactIn: boolean,
    tickSpacing: bigint,
    minTick: bigint,
    length0: bigint,
    length1: bigint,
    alpha0X96: bigint,
    alpha1X96: bigint,
    weight0: bigint,
    weight1: bigint,
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
        minTick,
        length0,
        length1,
        alpha0X96,
        alpha1X96,
        weight0,
        weight1,
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
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          )
        : this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          );

      cumulativeAmount1_ = exactIn
        ? this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          )
        : this.cumulativeAmount1(
            roundedTick - tickSpacing,
            totalLiquidity,
            tickSpacing,
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length0,
          length1,
          alpha0X96,
          alpha1X96,
          weight0,
          weight1,
        ) *
          totalLiquidity) >>
        96n;
    } else {
      ({ success, roundedTick } = this.inverseCumulativeAmount1(
        inverseCumulativeAmountInput,
        totalLiquidity,
        tickSpacing,
        minTick,
        length0,
        length1,
        alpha0X96,
        alpha1X96,
        weight0,
        weight1,
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
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          )
        : this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          );

      cumulativeAmount0_ = exactIn
        ? this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          )
        : this.cumulativeAmount0(
            roundedTick + tickSpacing,
            totalLiquidity,
            tickSpacing,
            minTick,
            length0,
            length1,
            alpha0X96,
            alpha1X96,
            weight0,
            weight1,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length0,
          length1,
          alpha0X96,
          alpha1X96,
          weight0,
          weight1,
        ) *
          totalLiquidity) >>
        96n;
    }

    return {
      success,
      roundedTick,
      cumulativeAmount0_,
      cumulativeAmount1_,
      swapLiquidity,
    };
  }

  static decodeParams(
    twapTick: bigint,
    tickSpacing: bigint,
    ldfParams: string,
  ): {
    minTick: bigint;
    length0: bigint;
    length1: bigint;
    alpha0X96: bigint;
    alpha1X96: bigint;
    weight0: bigint;
    weight1: bigint;
    shiftMode: ShiftMode;
  } {
    const shiftMode: number = Number(
      BigInt.asUintN(8, BigInt(`0x${ldfParams.slice(2, 4)}`)),
    );
    let minTick: bigint;
    const length0: bigint = BigInt.asIntN(
      24,
      BigInt.asIntN(
        16,
        BigInt.asUintN(16, BigInt(`0x${ldfParams.slice(10, 14)}`)),
      ),
    );
    const alpha0: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(14, 22)}`),
    );
    const weight0: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(22, 30)}`),
    );
    const length1: bigint = BigInt.asIntN(
      24,
      BigInt.asIntN(
        16,
        BigInt.asUintN(16, BigInt(`0x${ldfParams.slice(30, 34)}`)),
      ),
    );
    const alpha1: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(34, 42)}`),
    );
    const weight1: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(42, 50)}`),
    );

    const alpha0X96: bigint = mulDiv(alpha0, Q96, ALPHA_BASE);
    const alpha1X96: bigint = mulDiv(alpha1, Q96, ALPHA_BASE);

    if (shiftMode !== ShiftMode.STATIC) {
      // use rounded TWAP value + offset as minTick
      const offset = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(4, 10)}`)),
      );
      minTick = roundTickSingle(twapTick + offset, tickSpacing);

      // bound distribution to be within the range of usable ticks
      const [minUsableTick, maxUsableTick] = [
        TickMath.minUsableTick(tickSpacing),
        TickMath.maxUsableTick(tickSpacing),
      ];
      if (minTick < minUsableTick) minTick = minUsableTick;
      else if (minTick > maxUsableTick - (length0 + length1) * tickSpacing)
        minTick = maxUsableTick - (length0 + length1) * tickSpacing;
    } else {
      // static minTick set in params
      minTick = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(4, 10)}`)),
      );
    }

    return {
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
      shiftMode,
    };
  }
}
