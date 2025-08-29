export function decodeAmAmmPayload(payload: string): {
  swapFee0For1: bigint;
  swapFee1For0: bigint;
} {
  return {
    swapFee0For1: BigInt.asUintN(24, BigInt(`0x${payload.slice(2, 8)}`)),
    swapFee1For0: BigInt.asUintN(24, BigInt(`0x${payload.slice(8, 14)}`)),
  };
}
