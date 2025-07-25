import { MAX_U128 } from './constants';
import { amount0Delta, amount1Delta } from './delta';
import { nextSqrtRatioFromAmount0, nextSqrtRatioFromAmount1 } from './price';

interface SwapResult {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  sqrtRatioNext: bigint;
  feeAmount: bigint;
}

export function isPriceIncreasing(amount: bigint, isToken1: boolean): boolean {
  return amount < 0n !== isToken1;
}

function noOp(sqrtRatioNext: bigint): SwapResult {
  return {
    consumedAmount: 0n,
    calculatedAmount: 0n,
    sqrtRatioNext,
    feeAmount: 0n,
  };
}

export function amountBeforeFee(amount: bigint, fee: bigint): bigint {
  if (fee === 0n) return amount;
  const num = amount << 64n;
  const denom = (1n << 64n) - fee;
  const val = num / denom;
  const result = val + (num % denom !== 0n ? 1n : 0n);
  if (result > MAX_U128) throw new Error('AMOUNT_BEFORE_FEE_OVERFLOW');
  return result;
}

export function computeFee(amount: bigint, fee: bigint) {
  const num = amount * fee;
  const denom = 2n ** 64n;
  if (num % denom !== 0n) {
    return num / denom + 1n;
  } else {
    return num / denom;
  }
}

export function computeStep({
  sqrtRatio,
  liquidity,
  sqrtRatioLimit,
  amount,
  isToken1,
  fee,
}: {
  sqrtRatio: bigint;
  liquidity: bigint;
  sqrtRatioLimit: bigint;
  amount: bigint;
  isToken1: boolean;
  fee: bigint;
}): SwapResult {
  if (amount === 0n || sqrtRatio === sqrtRatioLimit) {
    return noOp(sqrtRatio);
  }

  const increasing = isPriceIncreasing(amount, isToken1);

  if (sqrtRatioLimit < sqrtRatio === increasing) {
    throw new Error('computeStep: wrong direction');
  }

  if (liquidity === 0n) {
    return noOp(sqrtRatioLimit);
  }

  let priceImpactAmount: bigint;
  if (amount < 0n) {
    priceImpactAmount = amount;
  } else {
    priceImpactAmount = amount - computeFee(amount, fee);
  }

  let sqrtRatioNextFromAmount: bigint | null;
  if (isToken1) {
    sqrtRatioNextFromAmount = nextSqrtRatioFromAmount1(
      sqrtRatio,
      liquidity,
      priceImpactAmount,
    );
  } else {
    sqrtRatioNextFromAmount = nextSqrtRatioFromAmount0(
      sqrtRatio,
      liquidity,
      priceImpactAmount,
    );
  }

  if (
    sqrtRatioNextFromAmount === null ||
    sqrtRatioNextFromAmount > sqrtRatioLimit === increasing
  ) {
    const [specifiedAmountDelta, calculatedAmountDelta]: [bigint, bigint] =
      isToken1
        ? [
            amount1Delta(sqrtRatioLimit, sqrtRatio, liquidity, amount >= 0n) *
              (amount < 0n ? -1n : 1n),
            amount0Delta(sqrtRatioLimit, sqrtRatio, liquidity, amount < 0n),
          ]
        : [
            amount0Delta(sqrtRatioLimit, sqrtRatio, liquidity, amount >= 0n) *
              (amount < 0n ? -1n : 1n),
            amount1Delta(sqrtRatioLimit, sqrtRatio, liquidity, amount < 0n),
          ];

    if (amount < 0n) {
      const beforeFee = amountBeforeFee(calculatedAmountDelta, fee);
      return {
        consumedAmount: specifiedAmountDelta,
        calculatedAmount: beforeFee,
        feeAmount: beforeFee - calculatedAmountDelta,
        sqrtRatioNext: sqrtRatioLimit,
      };
    } else {
      const beforeFee = amountBeforeFee(specifiedAmountDelta, fee);
      return {
        consumedAmount: beforeFee,
        calculatedAmount: calculatedAmountDelta,
        feeAmount: beforeFee - specifiedAmountDelta,
        sqrtRatioNext: sqrtRatioLimit,
      };
    }
  }

  if (sqrtRatioNextFromAmount === sqrtRatio) {
    return {
      consumedAmount: amount,
      calculatedAmount: 0n,
      feeAmount: amount,
      sqrtRatioNext: sqrtRatio,
    };
  }

  const calculatedAmountExcludingFee = isToken1
    ? amount0Delta(sqrtRatioNextFromAmount, sqrtRatio, liquidity, amount < 0n)
    : amount1Delta(sqrtRatioNextFromAmount, sqrtRatio, liquidity, amount < 0n);

  if (amount < 0n) {
    const includingFee = amountBeforeFee(calculatedAmountExcludingFee, fee);
    return {
      consumedAmount: amount,
      calculatedAmount: includingFee,
      sqrtRatioNext: sqrtRatioNextFromAmount,
      feeAmount: includingFee - calculatedAmountExcludingFee,
    };
  } else {
    return {
      consumedAmount: amount,
      calculatedAmount: calculatedAmountExcludingFee,
      sqrtRatioNext: sqrtRatioNextFromAmount,
      feeAmount: amount - priceImpactAmount,
    };
  }
}
