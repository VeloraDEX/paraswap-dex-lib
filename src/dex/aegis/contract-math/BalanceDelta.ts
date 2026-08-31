export function toBalanceDelta(amount0: bigint, amount1: bigint): bigint {
  const shiftedAmount0 = amount0 << 128n;

  const mask = (1n << 128n) - 1n;

  const maskedAmount1 = amount1 & mask;

  const balanceDelta = shiftedAmount0 | maskedAmount1;

  return balanceDelta;
}

export class BalanceDelta {
  static readonly ZERO_DELTA = 0n;

  static amount0(balanceDelta: bigint): bigint {
    return balanceDelta >> BigInt(128);
  }

  static amount1(balanceDelta: bigint): bigint {
    return BigInt.asIntN(128, balanceDelta);
  }
}
