import { max, min, mulDiv, mulDivUp, subReLU } from '../lib/Math';
import { SqrtPriceMath } from '../lib/SqrtPriceMath';

export const MAX_SWAP_FEE: bigint = 1_000_000n;
export const MIN_FEE_AMOUNT: bigint = 1_000n;

export function getSqrtPriceTarget(
  zeroForOne: boolean,
  sqrtPriceNextX96: bigint,
  sqrtPriceLimitX96: bigint,
): bigint {
  return zeroForOne
    ? max(sqrtPriceNextX96, sqrtPriceLimitX96)
    : min(sqrtPriceNextX96, sqrtPriceLimitX96);
}

export function computeSwapStep(
  sqrtPriceCurrentX96: bigint,
  sqrtPriceTargetX96: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  feePips: bigint,
): { sqrtPriceNextX96: bigint; amountIn: bigint; amountOut: bigint } {
  let sqrtPriceNextX96: bigint = 0n;
  let amountIn: bigint = 0n;
  let amountOut: bigint = 0n;
  let feeAmount: bigint = 0n;

  const zeroForOne: boolean = sqrtPriceCurrentX96 >= sqrtPriceTargetX96;
  const exactIn: boolean = amountRemaining < 0n;

  if (exactIn) {
    const amountRemainingLessFee: bigint = min(
      mulDiv(-amountRemaining, MAX_SWAP_FEE - feePips, MAX_SWAP_FEE),
      subReLU(-amountRemaining, MIN_FEE_AMOUNT),
    );

    amountIn = zeroForOne
      ? SqrtPriceMath.getAmount0Delta(
          sqrtPriceTargetX96,
          sqrtPriceCurrentX96,
          liquidity,
          true,
        )
      : SqrtPriceMath.getAmount1Delta(
          sqrtPriceCurrentX96,
          sqrtPriceTargetX96,
          liquidity,
          true,
        );

    if (amountRemainingLessFee >= amountIn) {
      sqrtPriceNextX96 = sqrtPriceTargetX96;
      feeAmount =
        feePips === MAX_SWAP_FEE
          ? amountIn
          : max(
              mulDivUp(amountIn, feePips, MAX_SWAP_FEE - feePips),
              MIN_FEE_AMOUNT,
            );
    } else {
      amountIn = amountRemainingLessFee;
      sqrtPriceNextX96 = SqrtPriceMath.getNextSqrtPriceFromInput(
        sqrtPriceCurrentX96,
        liquidity,
        amountRemainingLessFee,
        zeroForOne,
      );
      feeAmount = max(-amountRemaining - amountIn, MIN_FEE_AMOUNT);
    }

    amountOut = zeroForOne
      ? SqrtPriceMath.getAmount1Delta(
          sqrtPriceNextX96,
          sqrtPriceCurrentX96,
          liquidity,
          false,
        )
      : SqrtPriceMath.getAmount0Delta(
          sqrtPriceCurrentX96,
          sqrtPriceNextX96,
          liquidity,
          false,
        );
  } else {
    amountOut = zeroForOne
      ? SqrtPriceMath.getAmount1Delta(
          sqrtPriceTargetX96,
          sqrtPriceCurrentX96,
          liquidity,
          false,
        )
      : SqrtPriceMath.getAmount0Delta(
          sqrtPriceCurrentX96,
          sqrtPriceTargetX96,
          liquidity,
          false,
        );

    if (amountRemaining >= amountOut) {
      sqrtPriceNextX96 = sqrtPriceTargetX96;
    } else {
      amountOut = amountRemaining;
      sqrtPriceNextX96 = SqrtPriceMath.getNextSqrtPriceFromOutput(
        sqrtPriceCurrentX96,
        liquidity,
        amountOut,
        zeroForOne,
      );
    }

    amountIn = zeroForOne
      ? SqrtPriceMath.getAmount0Delta(
          sqrtPriceNextX96,
          sqrtPriceCurrentX96,
          liquidity,
          true,
        )
      : SqrtPriceMath.getAmount1Delta(
          sqrtPriceCurrentX96,
          sqrtPriceNextX96,
          liquidity,
          true,
        );

    feeAmount = max(
      mulDivUp(amountIn, feePips, MAX_SWAP_FEE - feePips),
      MIN_FEE_AMOUNT,
    );
  }

  if (exactIn) amountIn = min(amountIn + feeAmount, -amountRemaining);
  else amountIn += feeAmount;

  return { sqrtPriceNextX96, amountIn, amountOut };
}
