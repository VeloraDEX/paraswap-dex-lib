import { SqrtPriceMath } from './SqrtPriceMath';

export abstract class LiquidityAmounts {
  static getAmountsForLiquidity(
    sqrtRatioX96: bigint,
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundingUp: boolean,
  ): { amount0: bigint; amount1: bigint } {
    let amount0: bigint = 0n;
    let amount1: bigint = 0n;

    if (sqrtRatioAX96 > sqrtRatioBX96)
      [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];

    if (sqrtRatioX96 <= sqrtRatioAX96) {
      amount0 = SqrtPriceMath.getAmount0Delta(
        sqrtRatioAX96,
        sqrtRatioBX96,
        liquidity,
        roundingUp,
      );
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
      amount0 = SqrtPriceMath.getAmount0Delta(
        sqrtRatioX96,
        sqrtRatioBX96,
        liquidity,
        roundingUp,
      );
      amount1 = SqrtPriceMath.getAmount1Delta(
        sqrtRatioAX96,
        sqrtRatioX96,
        liquidity,
        roundingUp,
      );
    } else {
      amount1 = SqrtPriceMath.getAmount1Delta(
        sqrtRatioAX96,
        sqrtRatioBX96,
        liquidity,
        roundingUp,
      );
    }

    return { amount0, amount1 };
  }
}
