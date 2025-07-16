import { AddressZero } from '@ethersproject/constants';

/**
 * Converts any value to a BigInt, handling ethers.js BigNumber objects
 * @param value - The value to convert to BigInt
 * @returns A BigInt value
 */
export function toBigInt(value: any): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'object' && value && 'hex' in value) {
    return BigInt(value.hex);
  }
  return BigInt(value);
}

/**
 * Calculates fee components for ApexDefi pools
 * @param feeHookDetails - Fee hook details from factory
 * @param feeRate - Default fee rate from factory
 * @returns Object containing baseSwapRate, protocolFee, and lpFee
 */
export function calculateFees(
  feeHookDetails: [string, any, any, any],
  feeRate: any,
): { baseSwapRate: bigint; protocolFee: bigint; lpFee: bigint } {
  const hasFeeHook = feeHookDetails[0] !== AddressZero;
  const baseSwapRate = hasFeeHook ? toBigInt(feeHookDetails[1]) : 30n;
  const protocolFee = hasFeeHook
    ? toBigInt(feeHookDetails[3])
    : toBigInt(feeRate);
  const lpFee = hasFeeHook
    ? toBigInt(feeHookDetails[2])
    : 30n - toBigInt(feeRate);

  return { baseSwapRate, protocolFee, lpFee };
}
