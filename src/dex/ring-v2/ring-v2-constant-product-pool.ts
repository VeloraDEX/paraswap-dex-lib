import { RESERVE_LIMIT } from './ring-v2';
import { RingV2PoolOrderedParams } from './types';

export class Ringv2ConstantProductPool {
  static getSellPrice(
    priceParams: RingV2PoolOrderedParams,
    srcAmount: bigint,
    feeFactor: number,
  ): bigint {
    const { reservesIn, reservesOut, fee } = priceParams;

    if (BigInt(reservesIn) + srcAmount > RESERVE_LIMIT) {
      return 0n;
    }

    const amountInWithFee = srcAmount * BigInt(feeFactor - parseInt(fee));

    const numerator = amountInWithFee * BigInt(reservesOut);

    const denominator =
      BigInt(reservesIn) * BigInt(feeFactor) + amountInWithFee;

    return denominator === 0n ? 0n : numerator / denominator;
  }

  static getBuyPrice(
    priceParams: RingV2PoolOrderedParams,
    destAmount: bigint,
    feeFactor: number,
  ): bigint {
    const { reservesIn, reservesOut, fee } = priceParams;

    const numerator = BigInt(reservesIn) * destAmount * BigInt(feeFactor);
    const denominator =
      (BigInt(feeFactor) - BigInt(fee)) * (BigInt(reservesOut) - destAmount);

    if (denominator <= 0n) return 0n;
    return numerator === 0n ? 0n : 1n + numerator / denominator;
  }
}
