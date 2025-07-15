import { MAX_INT } from './constants';

// Indexes represent the number of zeros after 1
// We use as much as 36 zeros
export const BI_POWS = new Array(37)
  .fill(undefined)
  .map((_0, index) => BigInt(`1${'0'.repeat(index)}`));

export const BI_MAX_INT = BigInt(MAX_INT);

export const BI_MAX_UINT8 = 2n ** 8n - 1n;
export const BI_MAX_UINT16 = 2n ** 16n - 1n;
export const BI_MAX_UINT32 = 2n ** 32n - 1n;
export const BI_MAX_UINT48 = 2n ** 48n - 1n;
export const BI_MAX_UINT64 = 2n ** 64n - 1n;
export const BI_MAX_UINT96 = 2n ** 96n - 1n;
export const BI_MAX_UINT128 = 2n ** 128n - 1n;
export const BI_MAX_UINT160 = 2n ** 160n - 1n;
export const BI_MAX_UINT256 = 2n ** 256n - 1n;

export const BI_ADDR_MASK = (1n << 160n) - 1n;
