import { hexlify } from 'ethers/lib/utils';

import { Q96, WAD } from '../lib/Constants';
import { FullMathX96 } from '../lib/FullMathX96';
import {
  dist,
  fullMulDiv,
  fullMulDivUp,
  mulDiv,
  mulDivUp,
  roundTickSingle,
  rpow,
  xWadToRoundedTick,
} from '../lib/Math';
import { TickMath } from '../lib/TickMath';
import { PoolKey } from '../types';
import { enforceShiftMode, ShiftMode } from './ShiftMode';
import { ExpMath } from '../lib/ExpMath';
import { FixedPointMath } from '../lib/FixedPointMath';

const INITIALIZED_STATE: bigint = 1n << 24n;

export abstract class GeometricDistribution {
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

    let { minTick, length, alphaX96, shiftMode } =
      LibGeometricDistribution.decodeParams(
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
    } = LibGeometricDistribution.query(
      roundedTick,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
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
    let { minTick, length, alphaX96, shiftMode } =
      LibGeometricDistribution.decodeParams(
        twapTick,
        key.tickSpacing,
        ldfParams,
      );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibGeometricDistribution.computeSwap(
      inverseCumulativeAmountInput,
      totalLiquidity,
      zeroForOne,
      exactIn,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
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
    let { minTick, length, alphaX96, shiftMode } =
      LibGeometricDistribution.decodeParams(
        twapTick,
        key.tickSpacing,
        ldfParams,
      );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibGeometricDistribution.cumulativeAmount0(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
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
    let { minTick, length, alphaX96, shiftMode } =
      LibGeometricDistribution.decodeParams(
        twapTick,
        key.tickSpacing,
        ldfParams,
      );
    const { initialized, lastMinTick } = this._decodeState(ldfState);
    if (initialized) {
      minTick = enforceShiftMode(minTick, lastMinTick, shiftMode);
    }

    return LibGeometricDistribution.cumulativeAmount1(
      roundedTick,
      totalLiquidity,
      key.tickSpacing,
      minTick,
      length,
      alphaX96,
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

export abstract class LibGeometricDistribution {
  static query(
    roundedTick: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
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
    );

    let x: bigint = 0n;
    if (roundedTick < minTick) {
      x -= 1n;
    } else if (roundedTick >= minTick + length * tickSpacing) {
      x = length;
    } else {
      x = (roundedTick - minTick) / tickSpacing;
    }

    const sqrtRatioTickSpacing = TickMath.getSqrtPriceAtTick(tickSpacing);
    const sqrtRatioNegTickSpacing = TickMath.getSqrtPriceAtTick(-tickSpacing);
    const sqrtRatioMinTick = TickMath.getSqrtPriceAtTick(minTick);
    const sqrtRatioNegMinTick = TickMath.getSqrtPriceAtTick(-minTick);

    if (alphaX96 > Q96) {
      const alphaInvX96 = mulDiv(Q96, Q96, alphaX96);

      if (x >= length - 1n) {
        cumulativeAmount0DensityX96 = 0n;
      } else {
        const xPlus1 = x + 1n;

        const lengthMinusX = length - xPlus1;
        const intermediateTermIsPositive =
          alphaInvX96 > sqrtRatioNegTickSpacing;
        const numeratorTermLeft = rpow(alphaInvX96, lengthMinusX, Q96);
        const numeratorTermRight = TickMath.getSqrtPriceAtTick(lengthMinusX);
        cumulativeAmount0DensityX96 = mulDivUp(
          mulDivUp(
            mulDivUp(
              Q96 - alphaInvX96,
              intermediateTermIsPositive
                ? numeratorTermLeft - numeratorTermRight
                : numeratorTermRight - numeratorTermLeft,
              intermediateTermIsPositive
                ? alphaInvX96 - sqrtRatioNegTickSpacing
                : sqrtRatioNegTickSpacing - alphaInvX96,
            ),
            TickMath.getSqrtPriceAtTick(-tickSpacing * xPlus1),
            Q96 - rpow(alphaInvX96, length, Q96),
          ),
          Q96 - sqrtRatioNegTickSpacing,
          sqrtRatioMinTick,
        );
      }

      if (x <= 0n) {
        cumulativeAmount1DensityX96 = 0n;
      } else {
        const alphaInvPowLengthX96 = rpow(alphaInvX96, length, Q96);

        const baseX96 = mulDiv(alphaX96, sqrtRatioTickSpacing, Q96);
        const numerator1 = alphaX96 - Q96;
        const denominator1 = baseX96 - Q96;
        const numerator2 =
          mulDivUp(
            rpow(alphaInvX96, length - x, Q96),
            TickMath.getSqrtPriceAtTick(x * tickSpacing),
            Q96,
          ) - alphaInvPowLengthX96;
        const denominator2 = Q96 - alphaInvPowLengthX96;
        cumulativeAmount1DensityX96 = mulDivUp(
          mulDivUp(
            mulDivUp(Q96, numerator2, denominator2),
            numerator1,
            denominator1,
          ),
          sqrtRatioTickSpacing - Q96,
          sqrtRatioNegMinTick,
        );
      }
    } else {
      if (x >= length - 1n) {
        cumulativeAmount0DensityX96 = 0n;
      } else {
        const baseX96 = mulDiv(alphaX96, sqrtRatioNegTickSpacing, Q96);
        const xPlus1 = x + 1n;
        const alphaPowXX96 = rpow(alphaX96, xPlus1, Q96);
        const alphaPowLengthX96 = rpow(alphaX96, length, Q96);
        const numerator =
          (Q96 - alphaX96) *
          (mulDivUp(
            alphaPowXX96,
            TickMath.getSqrtPriceAtTick(-tickSpacing * xPlus1),
            Q96,
          ) -
            mulDivUp(
              alphaPowLengthX96,
              TickMath.getSqrtPriceAtTick(-tickSpacing * length),
              Q96,
            ));
        const denominator = (Q96 - alphaPowLengthX96) * (Q96 - baseX96);
        cumulativeAmount0DensityX96 = mulDivUp(
          fullMulDivUp(Q96 - sqrtRatioNegTickSpacing, numerator, denominator),
          Q96,
          sqrtRatioMinTick,
        );
      }

      if (x <= 0n) {
        cumulativeAmount1DensityX96 = 0n;
      } else {
        const baseX96 = mulDiv(alphaX96, sqrtRatioTickSpacing, Q96);
        const numerator =
          dist(
            Q96,
            mulDivUp(
              rpow(alphaX96, x, Q96),
              TickMath.getSqrtPriceAtTick(tickSpacing * x),
              Q96,
            ),
          ) *
          (Q96 - alphaX96);
        const denominator =
          dist(Q96, baseX96) * (Q96 - rpow(alphaX96, length, Q96));
        cumulativeAmount1DensityX96 = mulDivUp(
          fullMulDivUp(sqrtRatioTickSpacing - Q96, numerator, denominator),
          sqrtRatioMinTick,
          Q96,
        );
      }
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
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
  ): bigint {
    let amount0: bigint = 0n;
    let cumulativeAmount0DensityX96: bigint = 0n;

    let x: bigint = 0n;
    if (roundedTick < minTick) {
      x = 0n;
    } else if (roundedTick >= minTick + length * tickSpacing) {
      return 0n;
    } else {
      x = (roundedTick - minTick) / tickSpacing;
    }

    const sqrtRatioNegTickSpacing = TickMath.getSqrtPriceAtTick(-tickSpacing);
    const sqrtRatioMinTick = TickMath.getSqrtPriceAtTick(minTick);

    if (alphaX96 > Q96) {
      const alphaInvX96 = mulDiv(Q96, Q96, alphaX96);

      if (x >= length) {
        amount0 = 0n;
      } else {
        const lengthMinusX = length - x;
        const intermediateTermIsPositive =
          alphaInvX96 > sqrtRatioNegTickSpacing;
        const numeratorTermLeft = rpow(alphaInvX96, lengthMinusX, Q96);
        const numeratorTermRight = TickMath.getSqrtPriceAtTick(
          -tickSpacing * lengthMinusX,
        );
        cumulativeAmount0DensityX96 = mulDivUp(
          mulDivUp(
            mulDivUp(
              Q96 - alphaInvX96,
              intermediateTermIsPositive
                ? numeratorTermLeft - numeratorTermRight
                : numeratorTermRight - numeratorTermLeft,
              intermediateTermIsPositive
                ? alphaInvX96 - sqrtRatioNegTickSpacing
                : sqrtRatioNegTickSpacing - alphaInvX96,
            ),
            TickMath.getSqrtPriceAtTick(-tickSpacing * x),
            Q96 - rpow(alphaInvX96, length, Q96),
          ),
          Q96 - sqrtRatioNegTickSpacing,
          sqrtRatioMinTick,
        );
      }
    } else {
      if (x >= length) {
        amount0 = 0n;
      } else {
        const baseX96 = mulDiv(alphaX96, sqrtRatioNegTickSpacing, Q96);
        const alphaPowXX96 = rpow(alphaX96, x, Q96);
        const alphaPowLengthX96 = rpow(alphaX96, length, Q96);
        const numerator =
          (Q96 - alphaX96) *
          (mulDivUp(
            alphaPowXX96,
            TickMath.getSqrtPriceAtTick(-tickSpacing * x),
            Q96,
          ) -
            mulDivUp(
              alphaPowLengthX96,
              TickMath.getSqrtPriceAtTick(-tickSpacing * length),
              Q96,
            ));
        const denominator = (Q96 - alphaPowLengthX96) * (Q96 - baseX96);

        cumulativeAmount0DensityX96 = fullMulDivUp(
          fullMulDivUp(Q96 - sqrtRatioNegTickSpacing, numerator, denominator),
          Q96,
          sqrtRatioMinTick,
        );
      }
    }

    return FullMathX96.fullMulX96Up(
      cumulativeAmount0DensityX96,
      totalLiquidity,
    );
  }

  static cumulativeAmount1(
    roundedTick: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
  ): bigint {
    let cumulativeAmount1DensityX96: bigint = 0n;

    let x: bigint = 0n;
    if (roundedTick < minTick) {
      return 0n;
    } else if (roundedTick >= minTick + length * tickSpacing) {
      x = length - 1n;
    } else {
      x = (roundedTick - minTick) / tickSpacing;
    }

    const sqrtRatioTickSpacing = TickMath.getSqrtPriceAtTick(tickSpacing);

    if (alphaX96 > Q96) {
      const alphaInvX96 = mulDiv(Q96, Q96, alphaX96);

      if (x < 0) {
        cumulativeAmount1DensityX96 = 0n;
      } else {
        const alphaInvPowLengthX96 = rpow(alphaInvX96, length, Q96);
        const sqrtRatioNegMinTick = TickMath.getSqrtPriceAtTick(-minTick);

        const baseX96 = mulDiv(alphaX96, sqrtRatioTickSpacing, Q96);
        const numerator1 = alphaX96 - Q96;
        const denominator1 = baseX96 - Q96;
        const numerator2 =
          mulDivUp(
            rpow(alphaInvX96, length - x - 1n, Q96),
            TickMath.getSqrtPriceAtTick((x + 1n) * tickSpacing),
            Q96,
          ) - alphaInvPowLengthX96;
        const denominator2 = Q96 - alphaInvPowLengthX96;
        cumulativeAmount1DensityX96 = mulDivUp(
          mulDivUp(
            mulDivUp(Q96, numerator2, denominator2),
            numerator1,
            denominator1,
          ),
          sqrtRatioTickSpacing - Q96,
          sqrtRatioNegMinTick,
        );
      }
    } else {
      if (x < 0) {
        cumulativeAmount1DensityX96 = 0n;
      } else {
        const sqrtRatioMinTick = TickMath.getSqrtPriceAtTick(minTick);
        const baseX96 = mulDiv(alphaX96, sqrtRatioTickSpacing, Q96);
        const numerator =
          dist(
            Q96,
            mulDivUp(
              rpow(alphaX96, x + 1n, Q96),
              TickMath.getSqrtPriceAtTick(tickSpacing * (x + 1n)),
              Q96,
            ),
          ) *
          (Q96 - alphaX96);
        const denominator =
          dist(Q96, baseX96) * (Q96 - rpow(alphaX96, length, Q96));
        cumulativeAmount1DensityX96 = mulDivUp(
          fullMulDivUp(sqrtRatioTickSpacing - Q96, numerator, denominator),
          sqrtRatioMinTick,
          Q96,
        );
      }
    }

    return FullMathX96.fullMulX96Up(
      cumulativeAmount1DensityX96,
      totalLiquidity,
    );
  }

  static inverseCumulativeAmount0(
    cumulativeAmount0_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
  ): { success: boolean; roundedTick: bigint } {
    let success: boolean = false;
    let roundedTick: bigint = 0n;

    if (cumulativeAmount0_ === 0n) {
      return { success: true, roundedTick: minTick + length * tickSpacing };
    }

    let cumulativeAmount0DensityX96 = fullMulDivUp(
      cumulativeAmount0_,
      Q96,
      totalLiquidity,
    );
    let sqrtRatioNegTickSpacing = TickMath.getSqrtPriceAtTick(-tickSpacing);
    let sqrtRatioMinTick = TickMath.getSqrtPriceAtTick(minTick);
    let baseX96 = mulDiv(alphaX96, sqrtRatioNegTickSpacing, Q96);
    let lnBaseX96 = ExpMath.lnQ96(baseX96);

    let xWad: bigint;
    if (alphaX96 > Q96) {
      const alphaInvX96 = mulDiv(Q96, Q96, alphaX96);

      const alphaInvPowLengthX96 = rpow(alphaInvX96, length, Q96);
      const intermediateTermIsPositive = alphaInvX96 > sqrtRatioNegTickSpacing;
      let tmp = mulDivUp(
        mulDivUp(
          mulDivUp(
            cumulativeAmount0DensityX96,
            sqrtRatioMinTick,
            Q96 - sqrtRatioNegTickSpacing,
          ),
          Q96 - alphaInvPowLengthX96,
          Q96,
        ),
        intermediateTermIsPositive
          ? alphaInvX96 - sqrtRatioNegTickSpacing
          : sqrtRatioNegTickSpacing - alphaInvX96,
        Q96 - alphaInvX96,
      );
      const sqrtPriceNegTickSpacingMulLength = TickMath.getSqrtPriceAtTick(
        -tickSpacing * length,
      );
      if (
        !intermediateTermIsPositive &&
        sqrtPriceNegTickSpacingMulLength <= tmp
      ) {
        const result = minTick + (length - 1n) * tickSpacing;
        if (
          cumulativeAmount0_ <=
          this.cumulativeAmount0(
            result,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          )
        ) {
          return { success: true, roundedTick: result };
        } else {
          return { success: false, roundedTick: 0n };
        }
      }
      tmp = intermediateTermIsPositive
        ? tmp + sqrtPriceNegTickSpacingMulLength
        : sqrtPriceNegTickSpacingMulLength - tmp;
      xWad = FixedPointMath.sDivWad(
        ExpMath.lnQ96RoundingUp(tmp) +
          length * ExpMath.lnQ96RoundingUp(alphaX96),
        lnBaseX96,
      );
    } else {
      const denominator = (Q96 - rpow(alphaX96, length, Q96)) * (Q96 - baseX96);
      const numerator = fullMulDivUp(
        mulDivUp(cumulativeAmount0DensityX96, sqrtRatioMinTick, Q96),
        denominator,
        Q96 - sqrtRatioNegTickSpacing,
      );
      const basePowXX96 =
        numerator / (Q96 - alphaX96) + rpow(baseX96, length, Q96);
      xWad = FixedPointMath.sDivWad(
        ExpMath.lnQ96RoundingUp(basePowXX96),
        lnBaseX96,
      );
    }

    if (xWad < 0) {
      const maxCumulativeAmount0 = this.cumulativeAmount0(
        minTick,
        totalLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
      );
      if (cumulativeAmount0_ > maxCumulativeAmount0) {
        return { success: false, roundedTick: 0n };
      } else {
        xWad = 0n;
      }
    }

    success = true;
    roundedTick = xWadToRoundedTick(xWad, minTick, tickSpacing, false);

    const maxTick = minTick + length * tickSpacing;
    if (roundedTick < minTick || roundedTick > maxTick) {
      return { success: false, roundedTick: 0n };
    }

    if (roundedTick == maxTick) {
      return { success: true, roundedTick: maxTick - tickSpacing };
    }

    return { success, roundedTick };
  }

  static inverseCumulativeAmount1(
    cumulativeAmount1_: bigint,
    totalLiquidity: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
  ): { success: boolean; roundedTick: bigint } {
    let success: boolean = false;
    let roundedTick: bigint = 0n;

    if (cumulativeAmount1_ === 0n) {
      return { success: true, roundedTick: minTick - tickSpacing };
    }

    const cumulativeAmount1DensityX96 = fullMulDiv(
      cumulativeAmount1_,
      Q96,
      totalLiquidity,
    );
    const sqrtRatioTickSpacing = TickMath.getSqrtPriceAtTick(tickSpacing);
    const baseX96 = mulDiv(alphaX96, sqrtRatioTickSpacing, Q96);
    const lnBaseX96 = ExpMath.lnQ96RoundingUp(baseX96);

    let xWad: bigint;
    if (alphaX96 > Q96) {
      const alphaInvX96 = mulDiv(Q96, Q96, alphaX96);
      const alphaInvPowLengthX96 = rpow(alphaInvX96, length, Q96);
      const sqrtRatioNegMinTick = TickMath.getSqrtPriceAtTick(-minTick);

      const numerator1 = alphaX96 - Q96;
      const denominator1 = baseX96 - Q96;
      const denominator2 = Q96 - alphaInvPowLengthX96;
      const numerator2 = mulDiv(
        mulDiv(
          mulDiv(
            cumulativeAmount1DensityX96,
            sqrtRatioNegMinTick,
            sqrtRatioTickSpacing - Q96,
          ),
          denominator1,
          numerator1,
        ),
        denominator2,
        Q96,
      );

      if (numerator2 + alphaInvPowLengthX96 === 0n) {
        return { success: false, roundedTick: 0n };
      }

      xWad =
        FixedPointMath.sDivWad(
          ExpMath.lnQ96(numerator2 + alphaInvPowLengthX96) +
            length * ExpMath.lnQ96(alphaX96),
          lnBaseX96,
        ) - WAD;
    } else {
      const sqrtRatioMinTick = TickMath.getSqrtPriceAtTick(minTick);

      const denominator =
        dist(Q96, baseX96) * (Q96 - rpow(alphaX96, length, Q96));
      const numerator = fullMulDiv(
        fullMulDiv(cumulativeAmount1DensityX96, Q96, sqrtRatioMinTick),
        denominator,
        sqrtRatioTickSpacing - Q96,
      );
      if (Q96 > baseX96 && Q96 <= numerator / (Q96 - alphaX96)) {
        if (
          cumulativeAmount1_ <=
          this.cumulativeAmount1(
            minTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          )
        ) {
          return { success: true, roundedTick: minTick };
        } else {
          return { success: false, roundedTick: 0n };
        }
      }
      const basePowXPlusOneX96 =
        Q96 > baseX96
          ? Q96 - numerator / (Q96 - alphaX96)
          : Q96 + numerator / (Q96 - alphaX96);
      xWad =
        FixedPointMath.sDivWad(ExpMath.lnQ96(basePowXPlusOneX96), lnBaseX96) -
        WAD;
    }

    // early return if xWad is obviously too large
    // the result (the smallest rounded tick whose cumulativeAmount1 is greater than or equal to the input) doesn't exist
    // thus return success = false
    const xWadMax = (length - 1n) * WAD;
    if (xWad > xWadMax) {
      // compare cumulativeAmount1_ with the max value of cumulativeAmount1()
      // due to precision errors sometimes xWad can be greater than xWadMax when cumulativeAmount1_
      // is close to the max value
      const maxCumulativeAmount1 = this.cumulativeAmount1(
        minTick + (length - 1n) * tickSpacing,
        totalLiquidity,
        tickSpacing,
        minTick,
        length,
        alphaX96,
      );
      if (cumulativeAmount1_ > maxCumulativeAmount1) {
        return { success: false, roundedTick: 0n };
      } else {
        // xWad shouldn't actually be greater than xWadMax
        // set it to xWadMax
        xWad = xWadMax;
      }
    }

    // get rounded tick from xWad
    success = true;
    roundedTick = xWadToRoundedTick(xWad, minTick, tickSpacing, true);

    // ensure roundedTick is within the valid range
    if (
      roundedTick < minTick - tickSpacing ||
      roundedTick >= minTick + length * tickSpacing
    ) {
      return { success: false, roundedTick: 0n };
    }

    // ensure that roundedTick is not (minTick - tickSpacing) when cumulativeAmount1_ is non-zero and rounding up
    // this can happen if the corresponding cumulative density is too small
    if (roundedTick == minTick - tickSpacing) {
      return { success: true, roundedTick: minTick };
    }

    return { success, roundedTick };
  }

  static liquidityDensityX96(
    roundedTick: bigint,
    tickSpacing: bigint,
    minTick: bigint,
    length: bigint,
    alphaX96: bigint,
  ): bigint {
    if (
      roundedTick < minTick ||
      roundedTick >= minTick + length * tickSpacing
    ) {
      return 0n;
    }

    const x: bigint = (roundedTick - minTick) / tickSpacing;
    if (alphaX96 > Q96) {
      // alpha > 1
      const alphaInvX96 = mulDiv(Q96, Q96, alphaX96);
      return fullMulDiv(
        rpow(alphaInvX96, length - x, Q96),
        alphaX96 - Q96,
        Q96 - rpow(alphaInvX96, length, Q96),
      );
    } else {
      // alpha <= 1
      return mulDiv(
        Q96 - alphaX96,
        rpow(alphaX96, x, Q96),
        Q96 - rpow(alphaX96, length, Q96),
      );
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
          )
        : this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          );

      cumulativeAmount1_ = exactIn
        ? this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          )
        : this.cumulativeAmount1(
            roundedTick - tickSpacing,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length,
          alphaX96,
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
          )
        : this.cumulativeAmount1(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          );

      cumulativeAmount0_ = exactIn
        ? this.cumulativeAmount0(
            roundedTick,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          )
        : this.cumulativeAmount0(
            roundedTick + tickSpacing,
            totalLiquidity,
            tickSpacing,
            minTick,
            length,
            alphaX96,
          );

      swapLiquidity =
        (this.liquidityDensityX96(
          roundedTick,
          tickSpacing,
          minTick,
          length,
          alphaX96,
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
    length: bigint;
    alphaX96: bigint;
    shiftMode: ShiftMode;
  } {
    const shiftMode: number = Number(
      BigInt.asUintN(8, BigInt(`0x${ldfParams.slice(2, 4)}`)),
    );
    let minTick: bigint;
    const length: bigint = BigInt.asIntN(
      24,
      BigInt.asIntN(
        16,
        BigInt.asUintN(16, BigInt(`0x${ldfParams.slice(10, 14)}`)),
      ),
    );
    const alpha: bigint = BigInt.asUintN(
      32,
      BigInt(`0x${ldfParams.slice(14, 22)}`),
    );
    const alphaX96: bigint = mulDiv(alpha, Q96, ALPHA_BASE);

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
      else if (minTick > maxUsableTick - length * tickSpacing)
        minTick = maxUsableTick - length * tickSpacing;
    } else {
      // static minTick set in params
      minTick = BigInt.asIntN(
        24,
        BigInt.asUintN(24, BigInt(`0x${ldfParams.slice(4, 10)}`)),
      );
    }

    return { minTick, length, alphaX96, shiftMode };
  }
}
