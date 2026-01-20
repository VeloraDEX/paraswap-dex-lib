import { MAX_U128, MAX_U256 } from './constants';

export function amount0Delta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (liquidity === 0n || sqrtRatioA === sqrtRatioB) return 0n;

  const [lower, upper] =
    sqrtRatioA < sqrtRatioB
      ? [sqrtRatioA, sqrtRatioB]
      : [sqrtRatioB, sqrtRatioA];

  const numerator = (liquidity << 128n) * (upper - lower);

  let result0 = numerator / upper;
  if (roundUp && numerator % upper !== 0n) {
    result0++;
  }

  if (result0 > MAX_U256) {
    throw new Error('AMOUNT0_DELTA_OVERFLOW_U256');
  }
  let result = result0 / lower;
  if (roundUp && result0 % lower !== 0n) {
    result++;
  }

  if (result > MAX_U128) {
    throw new Error('AMOUNT0_DELTA_OVERFLOW_U128');
  }

  return result;
}

const TWO_POW_128 = 0x100000000000000000000000000000000n;

export function amount1Delta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (liquidity === 0n || sqrtRatioA === sqrtRatioB) return 0n;

  const [lower, upper] =
    sqrtRatioA < sqrtRatioB
      ? [sqrtRatioA, sqrtRatioB]
      : [sqrtRatioB, sqrtRatioA];

  const result = liquidity * (upper - lower);

  if (result > MAX_U256) {
    throw new Error('AMOUNT1_DELTA_OVERFLOW_U256');
  }

  if (roundUp && result % TWO_POW_128 !== 0n) {
    const delta = result / TWO_POW_128 + 1n;
    if (delta > MAX_U128) {
      throw new Error('AMOUNT1_DELTA_OVERFLOW_U128');
    }
    return delta;
  } else {
    return result >> 128n;
  }
}
