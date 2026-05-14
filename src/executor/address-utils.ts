import type { Address } from '../types';

export function isWrappedNativeTokenAddress(
  address: Address,
  wrappedNativeTokenAddress: Address,
): boolean {
  return address.toLowerCase() === wrappedNativeTokenAddress.toLowerCase();
}
