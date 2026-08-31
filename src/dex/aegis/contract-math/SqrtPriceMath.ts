import { FixedPoint96 } from './FixedPoint96';
import { FullMath } from './FullMath';
import { UnsafeMath } from './UnsafeMath';
import { _require } from '../../../utils';

export class SqrtPriceMath {
  static getNextSqrtPriceFromAmount0RoundingUp(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    add: boolean,
  ): bigint {
    if (amount === 0n) return sqrtPX96;
    let numerator1 = liquidity << 96n;

    if (add) {
      let product = amount * sqrtPX96;
      let denominator = numerator1 + product;
      return (numerator1 * sqrtPX96 + denominator - 1n) / denominator;
    } else {
      let product = amount * sqrtPX96;
      _require(
        product < numerator1,
        'PriceOverflow',
        { product, numerator1 },
        'product < numerator1',
      );
      let denominator = numerator1 - product;
      return (numerator1 * sqrtPX96 + denominator - 1n) / denominator;
    }
  }

  static getNextSqrtPriceFromAmount1RoundingDown(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    add: boolean,
  ): bigint {
    if (add) {
      let quotient = (amount * FixedPoint96.Q96) / liquidity;
      return sqrtPX96 + quotient;
    } else {
      let quotient = (amount * FixedPoint96.Q96 + liquidity - 1n) / liquidity;
      _require(
        sqrtPX96 > quotient,
        'NotEnoughLiquidity',
        { sqrtPX96, quotient },
        'sqrtPX96 > quotient',
      );
      return sqrtPX96 - quotient;
    }
  }

  static getNextSqrtPriceFromInput(
    sqrtPX96: bigint,
    liquidity: bigint,
    amountIn: bigint,
    zeroForOne: boolean,
  ): bigint {
    _require(
      sqrtPX96 !== 0n && liquidity !== 0n,
      'InvalidPriceOrLiquidity',
      { sqrtPX96, liquidity },
      'sqrtPX96 !== 0n && liquidity !== 0n',
    );

    return zeroForOne
      ? SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp(
          sqrtPX96,
          liquidity,
          amountIn,
          true,
        )
      : SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown(
          sqrtPX96,
          liquidity,
          amountIn,
          true,
        );
  }

  static getNextSqrtPriceFromOutput(
    sqrtPX96: bigint,
    liquidity: bigint,
    amountOut: bigint,
    zeroForOne: boolean,
  ): bigint {
    _require(
      sqrtPX96 !== 0n && liquidity !== 0n,
      'InvalidPriceOrLiquidity',
      { sqrtPX96, liquidity },
      'sqrtPX96 !== 0n && liquidity !== 0n',
    );

    return zeroForOne
      ? SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown(
          sqrtPX96,
          liquidity,
          amountOut,
          false,
        )
      : SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp(
          sqrtPX96,
          liquidity,
          amountOut,
          false,
        );
  }

  static getAmount0Delta(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    liquidity: bigint,
    roundUp: boolean,
  ): bigint {
    if (sqrtPriceAX96 > sqrtPriceBX96)
      [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];

    let numerator1 = BigInt.asIntN(256, liquidity) << FixedPoint96.RESOLUTION;
    let numerator2 = sqrtPriceBX96 - sqrtPriceAX96;

    return roundUp
      ? UnsafeMath.divRoundingUp(
          FullMath.mulDivRoundingUp(numerator1, numerator2, sqrtPriceBX96),
          sqrtPriceAX96,
        )
      : FullMath.mulDiv(numerator1, numerator2, sqrtPriceBX96) / sqrtPriceAX96;
  }

  static getAmount1Delta(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    liquidity: bigint,
    roundUp: boolean,
  ): bigint {
    if (sqrtPriceAX96 > sqrtPriceBX96)
      [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];

    const _liquidity = BigInt.asUintN(256, liquidity);

    return roundUp
      ? FullMath.mulDivRoundingUp(
          _liquidity,
          sqrtPriceBX96 - sqrtPriceAX96,
          FixedPoint96.Q96,
        )
      : FullMath.mulDiv(
          _liquidity,
          sqrtPriceBX96 - sqrtPriceAX96,
          FixedPoint96.Q96,
        );
  }
}
