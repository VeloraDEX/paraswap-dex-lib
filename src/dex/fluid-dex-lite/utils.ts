import { defaultAbiCoder, Interface } from '@ethersproject/abi';
import { hexZeroPad, keccak256 } from 'ethers/lib/utils';
import { Address } from '@paraswap/core';
import { uint256ToBigInt } from '../../lib/decoders';
import { DexKey } from './types';

export function encodeSlot(slot: bigint | number) {
  return hexZeroPad('0x' + BigInt(slot).toString(16), 32);
}

export function readFromStorageCall(
  target: Address,
  iface: Interface,
  slot: string,
) {
  return {
    target,
    callData: iface.encodeFunctionData('readFromStorage', [slot]),
    decodeFunction: uint256ToBigInt,
  };
}

export function calculateMappingStorageSlot(slot: number, key: string): string {
  // For bytes8 keys in Solidity mappings, we need to pad to bytes32
  // The dexId is bytes8 but storage slot calculation expects bytes32
  const paddedKey = key.padEnd(66, '0'); // Pad to 32 bytes (0x + 64 hex chars)

  // Solidity mapping storage slot calculation: keccak256(abi.encode(key, slot))
  const encoded = defaultAbiCoder.encode(
    ['bytes32', 'uint256'],
    [paddedKey, slot],
  );

  return keccak256(encoded);
}

// Helper function to calculate dexId like in Solidity: bytes8(keccak256(abi.encode(dexKey)))
export function calculateDexId(dexKey: DexKey): string {
  const encoded = defaultAbiCoder.encode(
    ['address', 'address', 'bytes32'],
    [dexKey.token0, dexKey.token1, dexKey.salt],
  );
  const hash = keccak256(encoded);
  // Take first 8 bytes (16 hex chars)
  return '0x' + hash.slice(2, 18);
}

export function normalizeDexId(dexId: string | undefined): string | null {
  if (!dexId) {
    return null;
  }

  // Convert to lowercase and ensure it's a string
  const idStr = dexId.toString().toLowerCase();

  // If it starts with 0x, ensure we have exactly 18 characters total (0x + 16 hex chars)
  if (idStr.startsWith('0x')) {
    return '0x' + idStr.slice(2).padStart(16, '0');
  } else {
    // Add 0x prefix and pad to 16 hex characters
    return '0x' + idStr.padStart(16, '0');
  }
}
