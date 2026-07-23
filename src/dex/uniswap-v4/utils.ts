import { ethers } from 'ethers';
import { PoolKey, PoolState } from './types';

export function sortPools(a: PoolState, b: PoolState) {
  const idA = a.id.toUpperCase();
  const idB = b.id.toUpperCase();
  if (idA < idB) {
    return -1;
  }
  if (idA > idB) {
    return 1;
  }
  return 0;
}

export function toId(key: PoolKey): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [
        key.currency0.toLowerCase(),
        key.currency1.toLowerCase(),
        parseInt(key.fee),
        key.tickSpacing,
        key.hooks.toLowerCase(),
      ],
    ),
  );
}
