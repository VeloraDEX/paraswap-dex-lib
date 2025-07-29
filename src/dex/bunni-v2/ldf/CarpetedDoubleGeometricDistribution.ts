import { hexlify } from 'ethers/lib/utils';
import { PoolKey } from '../types';
import { enforceShiftMode, ShiftMode } from './ShiftMode';
import { Q96, WAD } from '../lib/Constants';
import { divUp, mulDiv, mulWad } from '../lib/Math';
import { TickMath } from '../lib/TickMath';
import { LibUniformDistribution } from './UniformDistribution';
import { LibDoubleGeometricDistribution } from './DoubleGeometricDistribution';

const INITIALIZED_STATE: bigint = 1n << 24n;

export abstract class CarpetedDoubleGeometricDistribution {
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

    let params = LibCarpetedDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      params.minTick = enforceShiftMode(
        params.minTick,
        lastMinTick,
        params.shiftMode,
      );
      shouldSurge = params.minTick !== lastMinTick;
    }

    const {
      liquidityDensityX96_,
      cumulativeAmount0DensityX96,
      cumulativeAmount1DensityX96,
    } = LibCarpetedDoubleGeometricDistribution.query(
      roundedTick,
      key.tickSpacing,
      params,
    );
    const newLdfState = this._encodeState(params.minTick);

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
    let params = LibCarpetedDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      params.minTick = enforceShiftMode(
        params.minTick,
        lastMinTick,
        params.shiftMode,
      );
    }

    return LibCarpetedDoubleGeometricDistribution.computeSwap(
      inverseCumulativeAmountInput,
      totalLiquidity,
      zeroForOne,
      exactIn,
      key.tickSpacing,
      params,
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
    let params = LibCarpetedDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      params.minTick = enforceShiftMode(
        params.minTick,
        lastMinTick,
        params.shiftMode,
      );
    }

    return LibCarpetedDoubleGeometricDistribution.cumulativeAmount0(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      params,
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
    let params = LibCarpetedDoubleGeometricDistribution.decodeParams(
      twapTick,
      key.tickSpacing,
      ldfParams,
    );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      params.minTick = enforceShiftMode(
        params.minTick,
        lastMinTick,
        params.shiftMode,
      );
    }

    return LibCarpetedDoubleGeometricDistribution.cumulativeAmount1(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      params,
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

const SCALED_Q96: bigint = 0x10000000000000000000000000n;
const QUERY_SCALE_SHIFT: bigint = 4n;

export abstract class LibCarpetedDoubleGeometricDistribution {
  static query(
    roundedTick: bigint,
    tickSpacing: bigint,
    params: Params,
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
      params,
    );

    cumulativeAmount0DensityX96 =
      this.cumulativeAmount0(
        roundedTick + tickSpacing,
        SCALED_Q96,
        tickSpacing,
        params,
      ) >> QUERY_SCALE_SHIFT;

    cumulativeAmount1DensityX96 =
      this.cumulativeAmount1(
        roundedTick - tickSpacing,
        SCALED_Q96,
        tickSpacing,
        params,
      ) >> QUERY_SCALE_SHIFT;

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
    params: Params,
  ): bigint {
    const length = params.length0 + params.length1;
    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      params.minTick,
      length,
      params.weightCarpet,
    );

    return (
      LibUniformDistribution.cumulativeAmount0(
        roundedTick,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        params.minTick,
        true,
      ) +
      LibDoubleGeometricDistribution.cumulativeAmount0(
        roundedTick,
        mainLiquidity,
        tickSpacing,
        params.minTick,
        params.length0,
        params.length1,
        params.alpha0X96,
        params.alpha1X96,
        params.weight0,
        params.weight1,
      ) +
      LibUniformDistribution.cumulativeAmount0(
        roundedTick,
        rightCarpetLiquidity,
        tickSpacing,
        params.minTick + length * tickSpacing,
        maxUsableTick,
        true,
      )
    );
  }

  static cumulativeAmount1(
    roundedTick: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    params: Params,
  ): bigint {
    const length = params.length0 + params.length1;
    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      params.minTick,
      length,
      params.weightCarpet,
    );

    return (
      LibUniformDistribution.cumulativeAmount1(
        roundedTick,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        params.minTick,
        true,
      ) +
      LibDoubleGeometricDistribution.cumulativeAmount1(
        roundedTick,
        mainLiquidity,
        tickSpacing,
        params.minTick,
        params.length0,
        params.length1,
        params.alpha0X96,
        params.alpha1X96,
        params.weight0,
        params.weight1,
      ) +
      LibUniformDistribution.cumulativeAmount1(
        roundedTick,
        rightCarpetLiquidity,
        tickSpacing,
        params.minTick + length * tickSpacing,
        maxUsableTick,
        true,
      )
    );
  }

  static inverseCumulativeAmount0(
    cumulativeAmount0_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    params: Params,
  ): { success: boolean; roundedTick: bigint } {
    if (cumulativeAmount0_ === 0n) {
      return {
        success: true,
        roundedTick: TickMath.maxUsableTick(tickSpacing),
      };
    }

    const length = params.length0 + params.length1;
    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      params.minTick,
      length,
      params.weightCarpet,
    );

    const rightCarpetCumulativeAmount0 =
      LibUniformDistribution.cumulativeAmount0(
        params.minTick + length * tickSpacing,
        rightCarpetLiquidity,
        tickSpacing,
        params.minTick + length * tickSpacing,
        maxUsableTick,
        true,
      );

    if (
      cumulativeAmount0_ <= rightCarpetCumulativeAmount0 &&
      rightCarpetLiquidity !== 0n
    ) {
      return LibUniformDistribution.inverseCumulativeAmount0(
        cumulativeAmount0_,
        rightCarpetLiquidity,
        tickSpacing,
        params.minTick + length * tickSpacing,
        maxUsableTick,
        true,
      );
    } else {
      let remainder = cumulativeAmount0_ - rightCarpetCumulativeAmount0;
      const mainCumulativeAmount0 =
        LibDoubleGeometricDistribution.cumulativeAmount0(
          params.minTick,
          mainLiquidity,
          tickSpacing,
          params.minTick,
          params.length0,
          params.length1,
          params.alpha0X96,
          params.alpha1X96,
          params.weight0,
          params.weight1,
        );

      if (remainder <= mainCumulativeAmount0) {
        return LibDoubleGeometricDistribution.inverseCumulativeAmount0(
          remainder,
          mainLiquidity,
          tickSpacing,
          params.minTick,
          params.length0,
          params.length1,
          params.alpha0X96,
          params.alpha1X96,
          params.weight0,
          params.weight1,
        );
      } else if (leftCarpetLiquidity !== 0n) {
        remainder -= mainCumulativeAmount0;
        return LibUniformDistribution.inverseCumulativeAmount0(
          remainder,
          leftCarpetLiquidity,
          tickSpacing,
          minUsableTick,
          params.minTick,
          true,
        );
      }
    }
    return { success: false, roundedTick: 0n };
  }

  static inverseCumulativeAmount1(
    cumulativeAmount1_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    params: Params,
  ): { success: boolean; roundedTick: bigint } {
    if (cumulativeAmount1_ === 0n) {
      return {
        success: true,
        roundedTick: TickMath.minUsableTick(tickSpacing) - tickSpacing,
      };
    }

    const length = params.length0 + params.length1;
    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      params.minTick,
      length,
      params.weightCarpet,
    );

    const leftCarpetCumulativeAmount1 =
      LibUniformDistribution.cumulativeAmount1(
        params.minTick,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        params.minTick,
        true,
      );

    if (
      cumulativeAmount1_ <= leftCarpetCumulativeAmount1 &&
      leftCarpetLiquidity !== 0n
    ) {
      return LibUniformDistribution.inverseCumulativeAmount1(
        cumulativeAmount1_,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        params.minTick,
        true,
      );
    } else {
      let remainder = cumulativeAmount1_ - leftCarpetCumulativeAmount1;
      const mainCumulativeAmount1 =
        LibDoubleGeometricDistribution.cumulativeAmount1(
          params.minTick + length * tickSpacing,
          mainLiquidity,
          tickSpacing,
          params.minTick,
          params.length0,
          params.length1,
          params.alpha0X96,
          params.alpha1X96,
          params.weight0,
          params.weight1,
        );

      if (remainder <= mainCumulativeAmount1) {
        return LibDoubleGeometricDistribution.inverseCumulativeAmount1(
          remainder,
          mainLiquidity,
          tickSpacing,
          params.minTick,
          params.length0,
          params.length1,
          params.alpha0X96,
          params.alpha1X96,
          params.weight0,
          params.weight1,
        );
      } else if (rightCarpetLiquidity !== 0n) {
        remainder -= mainCumulativeAmount1;
        return LibUniformDistribution.inverseCumulativeAmount1(
          remainder,
          rightCarpetLiquidity,
          tickSpacing,
          params.minTick + length * tickSpacing,
          maxUsableTick,
          true,
        );
      }
    }
    return { success: false, roundedTick: 0n };
  }

  static liquidityDensityX96(
    roundedTick: bigint,
    tickSpacing: bigint,
    params: Params,
  ): bigint {
    const length = params.length0 + params.length1;
    if (
      roundedTick >= params.minTick &&
      roundedTick < params.minTick + length * tickSpacing
    ) {
      return mulWad(
        LibDoubleGeometricDistribution.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          params.minTick,
          params.length0,
          params.length1,
          params.alpha0X96,
          params.alpha1X96,
          params.weight0,
          params.weight1,
        ),
        WAD - params.weightCarpet,
      );
    } else {
      const [minUsableTick, maxUsableTick] = [
        TickMath.minUsableTick(tickSpacing),
        TickMath.maxUsableTick(tickSpacing),
      ];
      const numRoundedTicksCarpeted =
        (maxUsableTick - minUsableTick) / tickSpacing - length;
      if (numRoundedTicksCarpeted <= 0n) {
        return 0n;
      }
      const mainLiquidity = mulWad(Q96, WAD - params.weightCarpet);
      const carpetLiquidity = Q96 - mainLiquidity;
      // return carpetLiquidity / numRoundedTicksCarpeted;
      return divUp(carpetLiquidity, numRoundedTicksCarpeted);
    }
  }

  static computeSwap(
    inverseCumulativeAmountInput: bigint,
    totalLiquidity: bigint,
    zeroForOne: boolean,
    exactIn: boolean,
    tickSpacing: bigint,
    params: Params,
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
        params,
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
            params,
          )
        : this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            params,
          );

      cumulativeAmount1_ = exactIn
        ? this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            params,
          )
        : this.cumulativeAmount1(
            roundedTick - tickSpacing,
            totalLiquidity,
            tickSpacing,
            params,
          );

      swapLiquidity =
        (this.liquidityDensityX96(roundedTick, tickSpacing, params) *
          totalLiquidity) >>
        96n;
    } else {
      ({ success, roundedTick } = this.inverseCumulativeAmount1(
        inverseCumulativeAmountInput,
        totalLiquidity,
        tickSpacing,
        params,
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
            params,
          )
        : this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            params,
          );

      cumulativeAmount0_ = exactIn
        ? this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            params,
          )
        : this.cumulativeAmount0(
            roundedTick + tickSpacing,
            totalLiquidity,
            tickSpacing,
            params,
          );

      swapLiquidity =
        (this.liquidityDensityX96(roundedTick, tickSpacing, params) *
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

  static getCarpetedLiquidity(
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    weightCarpet: bigint,
  ): {
    leftCarpetLiquidity: bigint;
    mainLiquidity: bigint;
    rightCarpetLiquidity: bigint;
    minUsableTick: bigint;
    maxUsableTick: bigint;
  } {
    const [minUsableTick, maxUsableTick] = [
      TickMath.minUsableTick(tickSpacing),
      TickMath.maxUsableTick(tickSpacing),
    ];
    const numRoundedTicksCarpeted =
      (maxUsableTick - minUsableTick) / tickSpacing - length;
    if (numRoundedTicksCarpeted <= 0n) {
      return {
        leftCarpetLiquidity: 0n,
        mainLiquidity: totalLiquidity,
        rightCarpetLiquidity: 0n,
        minUsableTick,
        maxUsableTick,
      };
    }
    const mainLiquidity = mulWad(totalLiquidity, WAD - weightCarpet);
    const carpetLiquidity = totalLiquidity - mainLiquidity;
    const rightCarpetLiquidity = mulDiv(
      carpetLiquidity,
      (maxUsableTick - minTick) / tickSpacing - length,
      numRoundedTicksCarpeted,
    );
    const leftCarpetLiquidity = carpetLiquidity - rightCarpetLiquidity;
    return {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    };
  }

  static decodeParams(
    twapTick: bigint,
    tickSpacing: bigint,
    ldfParams: string,
  ): Params {
    const weightCarpet: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(50, 58)}`),
    );

    const {
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
      tickSpacing,
      ldfParams,
    );

    return {
      minTick,
      length0,
      length1,
      alpha0X96,
      alpha1X96,
      weight0,
      weight1,
      weightCarpet,
      shiftMode,
    };
  }
}

type Params = {
  minTick: bigint;
  length0: bigint;
  alpha0X96: bigint;
  weight0: bigint;
  length1: bigint;
  alpha1X96: bigint;
  weight1: bigint;
  weightCarpet: bigint;
  shiftMode: ShiftMode;
};
