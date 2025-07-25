import { BI_MAX_UINT160 } from '../../../bigint-constants';
import { Q96 } from './Constants';
import { divUp, mulDiv, mulDivUp } from './Math';

export abstract class SqrtPriceMath {
  static getNextSqrtPriceFromAmount0RoundingUp(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    add: boolean,
  ): bigint {
    if (amount === 0n) return sqrtPX96;
    const numerator1 = liquidity << 96n;

    if (add) {
      const product = amount * sqrtPX96;
      if (product / amount === sqrtPX96) {
        const denominator = numerator1 + product;
        if (denominator >= numerator1) {
          return mulDivUp(numerator1, sqrtPX96, denominator);
        }
      }
      return divUp(numerator1, numerator1 / sqrtPX96 + amount);
    } else {
      const product = amount * sqrtPX96;
      if (product / amount !== sqrtPX96 || numerator1 <= product) {
        throw new Error('PriceOverflow');
      }
      const denominator = numerator1 - product;
      return mulDivUp(numerator1, sqrtPX96, denominator);
    }
  }

  static getNextSqrtPriceFromAmount1RoundingDown(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    add: boolean,
  ): bigint {
    if (add) {
      const quotient =
        amount <= BI_MAX_UINT160
          ? (amount << 96n) / liquidity
          : mulDiv(amount, Q96, liquidity);
      return sqrtPX96 + quotient;
    } else {
      const quotient =
        amount <= BI_MAX_UINT160
          ? divUp(amount << 96n, liquidity)
          : mulDivUp(amount, Q96, liquidity);
      if (sqrtPX96 <= quotient) {
        throw new Error('NotEnoughLiquidity');
      }
      return sqrtPX96 - quotient;
    }
  }

  static getNextSqrtPriceFromInput(
    sqrtPX96: bigint,
    liquidity: bigint,
    amountIn: bigint,
    zeroForOne: boolean,
  ): bigint {
    if (sqrtPX96 === 0n || liquidity === 0n) {
      throw new Error('InvalidPriceOrLiquidity');
    }

    return zeroForOne
      ? this.getNextSqrtPriceFromAmount0RoundingUp(
          sqrtPX96,
          liquidity,
          amountIn,
          true,
        )
      : this.getNextSqrtPriceFromAmount1RoundingDown(
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
    if (sqrtPX96 === 0n || liquidity === 0n) {
      throw new Error('InvalidPriceOrLiquidity');
    }

    return zeroForOne
      ? this.getNextSqrtPriceFromAmount1RoundingDown(
          sqrtPX96,
          liquidity,
          amountOut,
          false,
        )
      : this.getNextSqrtPriceFromAmount0RoundingUp(
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
    if (sqrtPriceAX96 > sqrtPriceBX96) {
      [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];
    }

    if (sqrtPriceAX96 === 0n) {
      throw new Error('InvalidPrice');
    }

    const numerator1 = liquidity << 96n;
    const numerator2 = sqrtPriceBX96 - sqrtPriceAX96;

    return roundUp
      ? divUp(mulDivUp(numerator1, numerator2, sqrtPriceBX96), sqrtPriceAX96)
      : mulDiv(numerator1, numerator2, sqrtPriceBX96) / sqrtPriceAX96;
  }

  static getAmount1Delta(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    liquidity: bigint,
    roundUp: boolean,
  ): bigint {
    return roundUp
      ? mulDivUp(liquidity, sqrtPriceBX96 - sqrtPriceAX96, Q96)
      : mulDiv(liquidity, sqrtPriceBX96 - sqrtPriceAX96, Q96);
  }
}
