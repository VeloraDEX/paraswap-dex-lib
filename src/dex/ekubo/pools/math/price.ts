import { BigNumber } from 'ethers';
import {
  MAX_U256,
  TWO_POW_128,
  TWO_POW_160,
  TWO_POW_192,
  TWO_POW_94,
  TWO_POW_95,
  TWO_POW_96,
} from './constants';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './tick';

const BIT_MASK = 0xc00000000000000000000000n;
const NOT_BIT_MASK = 0x3fffffffffffffffffffffffn;

export function floatSqrtRatioToFixed(sqrtRatioFloat: bigint): bigint {
  return (
    (sqrtRatioFloat & NOT_BIT_MASK) <<
    (2n + ((sqrtRatioFloat & BIT_MASK) >> 89n))
  );
}

export function fixedSqrtRatioToFloat(sqrtRatioFixed: bigint): bigint {
  if (sqrtRatioFixed >= TWO_POW_192) {
    throw new Error('Out of bounds');
  } else if (sqrtRatioFixed >= TWO_POW_160) {
    return (sqrtRatioFixed >> 98n) + BIT_MASK;
  } else if (sqrtRatioFixed >= TWO_POW_128) {
    return (sqrtRatioFixed >> 66n) + TWO_POW_95;
  } else if (sqrtRatioFixed >= TWO_POW_96) {
    return (sqrtRatioFixed >> 34n) + TWO_POW_94;
  } else {
    return sqrtRatioFixed >> 2n;
  }
}

export const MAX_SQRT_RATIO_FLOAT = BigNumber.from(
  fixedSqrtRatioToFloat(MAX_SQRT_RATIO),
);
export const MIN_SQRT_RATIO_FLOAT = BigNumber.from(
  fixedSqrtRatioToFloat(MIN_SQRT_RATIO),
);

export function nextSqrtRatioFromAmount0(
  sqrtRatio: bigint,
  liquidity: bigint,
  amount0: bigint,
): bigint | null {
  if (amount0 === 0n) return sqrtRatio;

  if (liquidity === 0n) throw new Error('NO_LIQUIDITY');

  const numerator1 = liquidity << 128n;

  // because quotient is rounded down, this price movement is also rounded towards sqrt_ratio
  if (amount0 < 0n) {
    const product = amount0 * -1n * sqrtRatio;

    if (product >= MAX_U256) {
      return null;
    }

    const denominator = numerator1 - product;

    if (denominator < 0n) {
      return null;
    }

    const num = numerator1 * sqrtRatio;

    const result = num / denominator + (num % denominator === 0n ? 0n : 1n);

    if (result > MAX_U256) {
      return null;
    }

    return result;
  } else {
    const denomP1 = numerator1 / sqrtRatio;

    const denom = denomP1 + amount0;
    const quotient = numerator1 / denom;
    const remainder = numerator1 % denom;

    if (remainder === 0n) return quotient;
    const sum = quotient + 1n;
    if (sum > MAX_U256) return null;
    return sum;
  }
}

export function nextSqrtRatioFromAmount1(
  sqrtRatio: bigint,
  liquidity: bigint,
  amount1: bigint,
): bigint | null {
  if (amount1 === 0n) return sqrtRatio;

  if (liquidity === 0n) throw new Error('NO_LIQUIDITY');

  const amountShifted = amount1 << 128n;
  const quotient = amountShifted / liquidity;
  const remainder = amountShifted % liquidity;

  // because quotient is rounded down, this price movement is also rounded towards sqrt_ratio
  if (amount1 < 0n) {
    // adding amount1, taking out amount0
    const res = sqrtRatio + quotient;
    if (res < 0n) {
      return null;
    }
    if (remainder === 0n) {
      return res;
    } else {
      if (res != 0n) {
        return res - 1n;
      } else {
        return null;
      }
    }
  } else {
    // adding amount1, taking out amount0, price goes up
    const res = sqrtRatio + quotient;
    if (res > MAX_U256) {
      return null;
    } else {
      return res;
    }
  }
}
