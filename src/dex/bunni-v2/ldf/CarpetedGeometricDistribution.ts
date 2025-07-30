import { hexlify } from 'ethers/lib/utils';
import { PoolKey } from '../types';
import { enforceShiftMode, ShiftMode } from './ShiftMode';
import { Q96, WAD } from '../lib/Constants';
import { mulDiv, mulWad } from '../lib/Math';
import { TickMath } from '../lib/TickMath';
import { LibUniformDistribution } from './UniformDistribution';
import { LibGeometricDistribution } from './GeometricDistribution';

const INITIALIZED_STATE: bigint = 1n << 24n;

export abstract class CarpetedGeometricDistribution {
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

    let { minTick, length, alphaX96, weightCarpet, shiftMode } =
      LibCarpetedGeometricDistribution.decodeParams(
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
    } = LibCarpetedGeometricDistribution.query(
      roundedTick,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
      weightCarpet,
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
    let { minTick, length, alphaX96, weightCarpet, shiftMode } =
      LibCarpetedGeometricDistribution.decodeParams(
        twapTick,
        key.tickSpacing,
        ldfParams,
      );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibCarpetedGeometricDistribution.computeSwap(
      inverseCumulativeAmountInput,
      totalLiquidity,
      zeroForOne,
      exactIn,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
      weightCarpet,
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
    let { minTick, length, alphaX96, weightCarpet, shiftMode } =
      LibCarpetedGeometricDistribution.decodeParams(
        twapTick,
        key.tickSpacing,
        ldfParams,
      );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibCarpetedGeometricDistribution.cumulativeAmount0(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
      weightCarpet,
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
    let { minTick, length, alphaX96, weightCarpet, shiftMode } =
      LibCarpetedGeometricDistribution.decodeParams(
        twapTick,
        key.tickSpacing,
        ldfParams,
      );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibCarpetedGeometricDistribution.cumulativeAmount1(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
      weightCarpet,
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

export abstract class LibCarpetedGeometricDistribution {
  static query(
    roundedTick: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
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
      length,
      alphaX96,
      weightCarpet,
    );

    cumulativeAmount0DensityX96 =
      this.cumulativeAmount0(
        roundedTick + tickSpacing,
        SCALED_Q96,
        tickSpacing,
        minTick,
        length,
        alphaX96,
        weightCarpet,
      ) >> QUERY_SCALE_SHIFT;

    cumulativeAmount1DensityX96 =
      this.cumulativeAmount1(
        roundedTick - tickSpacing,
        SCALED_Q96,
        tickSpacing,
        minTick,
        length,
        alphaX96,
        weightCarpet,
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
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
  ): bigint {
    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      minTick,
      length,
      weightCarpet,
    );

    return (
      LibUniformDistribution.cumulativeAmount0(
        roundedTick,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        minTick,
        true,
      ) +
      LibGeometricDistribution.cumulativeAmount0(
        roundedTick,
        mainLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
      ) +
      LibUniformDistribution.cumulativeAmount0(
        roundedTick,
        rightCarpetLiquidity,
        tickSpacing,
        minTick + length * tickSpacing,
        maxUsableTick,
        true,
      )
    );
  }

  static cumulativeAmount1(
    roundedTick: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
  ): bigint {
    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      minTick,
      length,
      weightCarpet,
    );

    return (
      LibUniformDistribution.cumulativeAmount1(
        roundedTick,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        minTick,
        true,
      ) +
      LibGeometricDistribution.cumulativeAmount1(
        roundedTick,
        mainLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
      ) +
      LibUniformDistribution.cumulativeAmount1(
        roundedTick,
        rightCarpetLiquidity,
        tickSpacing,
        minTick + length * tickSpacing,
        maxUsableTick,
        true,
      )
    );
  }

  static inverseCumulativeAmount0(
    cumulativeAmount0_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
  ): { success: boolean; roundedTick: bigint } {
    if (cumulativeAmount0_ === 0n) {
      return {
        success: true,
        roundedTick: TickMath.maxUsableTick(tickSpacing),
      };
    }

    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      minTick,
      length,
      weightCarpet,
    );

    const rightCarpetCumulativeAmount0 =
      LibUniformDistribution.cumulativeAmount0(
        minTick + length * tickSpacing,
        rightCarpetLiquidity,
        tickSpacing,
        minTick + length * tickSpacing,
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
        minTick + length * tickSpacing,
        maxUsableTick,
        true,
      );
    } else {
      let remainder = cumulativeAmount0_ - rightCarpetCumulativeAmount0;
      const mainCumulativeAmount0 = LibGeometricDistribution.cumulativeAmount0(
        minTick,
        mainLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
      );

      if (remainder <= mainCumulativeAmount0) {
        return LibGeometricDistribution.inverseCumulativeAmount0(
          remainder,
          mainLiquidity,
          tickSpacing,
          minTick,
          length,
          alphaX96,
        );
      } else if (leftCarpetLiquidity !== 0n) {
        remainder -= mainCumulativeAmount0;
        return LibUniformDistribution.inverseCumulativeAmount0(
          remainder,
          leftCarpetLiquidity,
          tickSpacing,
          minUsableTick,
          minTick,
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
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
  ): { success: boolean; roundedTick: bigint } {
    if (cumulativeAmount1_ === 0n) {
      return {
        success: true,
        roundedTick: TickMath.minUsableTick(tickSpacing) - tickSpacing,
      };
    }

    const {
      leftCarpetLiquidity,
      mainLiquidity,
      rightCarpetLiquidity,
      minUsableTick,
      maxUsableTick,
    } = this.getCarpetedLiquidity(
      totalLiquidity,
      tickSpacing,
      minTick,
      length,
      weightCarpet,
    );

    const leftCarpetCumulativeAmount1 =
      LibUniformDistribution.cumulativeAmount1(
        minTick,
        leftCarpetLiquidity,
        tickSpacing,
        minUsableTick,
        minTick,
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
        minTick,
        true,
      );
    } else {
      let remainder = cumulativeAmount1_ - leftCarpetCumulativeAmount1;
      const mainCumulativeAmount1 = LibGeometricDistribution.cumulativeAmount1(
        minTick + length * tickSpacing,
        mainLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
      );

      if (remainder <= mainCumulativeAmount1) {
        return LibGeometricDistribution.inverseCumulativeAmount1(
          remainder,
          mainLiquidity,
          tickSpacing,
          minTick,
          length,
          alphaX96,
        );
      } else if (rightCarpetLiquidity !== 0n) {
        remainder -= mainCumulativeAmount1;
        return LibUniformDistribution.inverseCumulativeAmount1(
          remainder,
          rightCarpetLiquidity,
          tickSpacing,
          minTick + length * tickSpacing,
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
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
  ): bigint {
    if (
      roundedTick >= minTick &&
      roundedTick < minTick + length * tickSpacing
    ) {
      return mulWad(
        LibGeometricDistribution.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length,
          alphaX96,
        ),
        WAD - weightCarpet,
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
      const mainLiquidity = mulWad(Q96, WAD - weightCarpet);
      const carpetLiquidity = Q96 - mainLiquidity;
      return carpetLiquidity / numRoundedTicksCarpeted;
    }
  }

  static computeSwap(
    inverseCumulativeAmountInput: bigint,
    totalLiquidity: bigint,
    zeroForOne: boolean,
    exactIn: boolean,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
    weightCarpet: bigint,
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
        length,
        alphaX96,
        weightCarpet,
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
            length,
            alphaX96,
            weightCarpet,
          )
        : this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
            weightCarpet,
          );

      cumulativeAmount1_ = exactIn
        ? this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
            weightCarpet,
          )
        : this.cumulativeAmount1(
            roundedTick - tickSpacing,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
            weightCarpet,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length,
          alphaX96,
          weightCarpet,
        ) *
          totalLiquidity) >>
        96n;
    } else {
      ({ success, roundedTick } = this.inverseCumulativeAmount1(
        inverseCumulativeAmountInput,
        totalLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
        weightCarpet,
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
            length,
            alphaX96,
            weightCarpet,
          )
        : this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
            weightCarpet,
          );

      cumulativeAmount0_ = exactIn
        ? this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
            weightCarpet,
          )
        : this.cumulativeAmount0(
            roundedTick + tickSpacing,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
            weightCarpet,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length,
          alphaX96,
          weightCarpet,
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
    const rightCarpetNumRoundedTicks =
      (maxUsableTick - minTick) / tickSpacing - length;
    const rightCarpetLiquidity = mulDiv(
      carpetLiquidity,
      rightCarpetNumRoundedTicks,
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
  ): {
    minTick: bigint;
    length: bigint;
    alphaX96: bigint;
    weightCarpet: bigint;
    shiftMode: ShiftMode;
  } {
    const weightCarpet: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(22, 30)}`),
    );

    const { minTick, length, alphaX96, shiftMode } =
      LibGeometricDistribution.decodeParams(twapTick, tickSpacing, ldfParams);

    return { minTick, length, alphaX96, weightCarpet, shiftMode };
  }
}
