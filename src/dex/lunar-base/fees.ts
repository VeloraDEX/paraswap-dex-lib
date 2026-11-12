import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { isAddress } from '@ethersproject/address';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { TransactionGasPriceOptions } from '../../types';

const ACCESS_SLOT = BigInt(
  '0x9832e62c6c6e13b4465b385de9f563995a2974f4f839176dcccf0b12e5c11200',
);
const MASK64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const hex32 = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');

// Current prod has no MEV-tax getters or setter event. Read the ERC-7201
// slots at the execution snapshot, never cache these as event-synced state.
// Legacy implementations leave the appended access fields zeroed.
export async function readExecutionFeePolicy(
  helper: IDexHelper,
  pool: string,
  blockNumber: number,
  txOrigin: string,
) {
  if (!isAddress(txOrigin))
    throw new Error('LunarBase: invalid tx.origin context');
  const blacklistSlot = keccak256(
    defaultAbiCoder.encode(
      ['address', 'uint256'],
      [txOrigin, ACCESS_SLOT + 2n],
    ),
  );
  const [packed, blacklisted] = await Promise.all([
    helper.provider.getStorageAt(pool, hex32(ACCESS_SLOT + 3n), blockNumber),
    helper.provider.getStorageAt(pool, blacklistSlot, blockNumber),
  ]);
  const value = BigInt(packed);
  return {
    thresholdWei: value & MASK64,
    scaleWei: (value >> 64n) & MASK64,
    originBlacklisted: BigInt(blacklisted) !== 0n,
  };
}

function feeValue(value: string): bigint {
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    throw new Error('LunarBase: invalid gas fee');
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) throw new Error('LunarBase: gas fee overflow');
  return parsed;
}

export function priorityFeeWei(
  options: TransactionGasPriceOptions,
  baseFee: bigint,
  taxEnabled: boolean,
): bigint {
  const { gasPrice, maxFeePerGas, maxPriorityFeePerGas } = options;
  if (gasPrice !== undefined) {
    if (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined) {
      throw new Error('LunarBase: mixed gas fee parameters');
    }
    const price = feeValue(gasPrice);
    return price > baseFee ? price - baseFee : 0n;
  }
  if (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined) {
    if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
      throw new Error('LunarBase: incomplete gas fee context');
    }
    const cap = feeValue(maxFeePerGas);
    const priority = feeValue(maxPriorityFeePerGas);
    if (cap < baseFee || priority > cap) {
      throw new Error('LunarBase: invalid gas fee cap');
    }
    return priority < cap - baseFee ? priority : cap - baseFee;
  }
  if (taxEnabled)
    throw new Error('LunarBase: gas fee context required for MEV tax');
  return 0n;
}
