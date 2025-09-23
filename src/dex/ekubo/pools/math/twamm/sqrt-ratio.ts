import { TWO_POW_128, TWO_POW_192, TWO_POW_64 } from '../constants';
import { exp2 } from './exp2';

const EXPONENT_LIMIT: bigint = 0x400000000000000000n;

function sqrt(x: bigint): bigint {
  if (x < 0n) {
    throw new Error('Square root of negative numbers is not supported.');
  }
  if (x < 2n) {
    return x;
  }

  let x0 = x / 2n;
  let x1 = (x0 + x / x0) / 2n;

  while (x0 > x1) {
    x0 = x1;
    x1 = (x0 + x / x0) / 2n;
  }

  return x0;
}

function computeSqrtSaleRatioX128(
  saleRateToken0: bigint,
  saleRateToken1: bigint,
): bigint {
  const saleRatio = (saleRateToken1 << 128n) / saleRateToken0;

  if (saleRatio < TWO_POW_128) {
    // Full precision
    return sqrt(saleRatio << 128n);
  } else if (saleRatio < TWO_POW_192) {
    // We know it only has 192 bits, so we can lsh it 64 before rooting to get more precision
    return sqrt(saleRatio << 64n) << 32n;
  } else {
    return sqrt(saleRatio << 16n) << 56n;
  }
}

export function calculateNextSqrtRatio(
  sqrtRatio: bigint,
  liquidity: bigint,
  saleRateToken0: bigint,
  saleRateToken1: bigint,
  timeElapsed: number,
  fee: bigint,
): bigint {
  const sqrtSaleRatio = computeSqrtSaleRatioX128(
    saleRateToken0,
    saleRateToken1,
  );

  if (liquidity === 0n) {
    return sqrtSaleRatio;
  }

  const saleRate =
    (sqrt(saleRateToken0 * saleRateToken1) * (TWO_POW_64 - fee)) / TWO_POW_64;
  const exponent = (saleRate * BigInt(timeElapsed) * 12392656037n) / liquidity;

  if (exponent >= EXPONENT_LIMIT) {
    return sqrtSaleRatio;
  }

  const twoPowExponentX128 = exp2(exponent) << 64n;

  const [num, sign] =
    sqrtRatio > sqrtSaleRatio
      ? [sqrtRatio - sqrtSaleRatio, true]
      : [sqrtSaleRatio - sqrtRatio, false];

  const c = (num << 128n) / (sqrtSaleRatio + sqrtRatio);

  const [term1, term2] = [twoPowExponentX128 - c, twoPowExponentX128 + c];

  return sign
    ? (sqrtSaleRatio * term2) / term1
    : (sqrtSaleRatio * term1) / term2;
}
