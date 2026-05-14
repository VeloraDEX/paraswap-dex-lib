import { Interface } from '@ethersproject/abi';
import AugustusV6ABI from '../../../src/abi/augustus-v6/ABI.json';
import { Executors } from '../../../src/executor/types';
import { createExecutorEncodingContextFromDexHelper } from '../../../src/executor/encoding-context';
import { createExecutorBytecodeBuilder } from '../../../src/executor/factory';
import type {
  BuildInput,
  DirectBuildInput,
  ResolvedBuildDeps,
  ResolvedDirectBuildDeps,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type { Address } from '../../../src/types';

export const AUGUSTUS_V6_INTERFACE = new Interface(AugustusV6ABI);

const DEFAULT_EXECUTOR_ADDRESSES: Record<Executors, Address> = {
  [Executors.ONE]: '0x000010036c0190e009a000d0fc3541100a07380a',
  [Executors.TWO]: '0x00c600b30fb0400701010f4b080409018b9006e0',
  [Executors.THREE]: '0xa000b020c290d000020aac04026b5306d60050f0',
  [Executors.WETH]: '0x0000000000000000000000000000000000000000',
};

export function createResolvedBuildDeps(input: BuildInput): ResolvedBuildDeps {
  const executorsAddresses = {
    ...DEFAULT_EXECUTOR_ADDRESSES,
    [Executors.WETH]: input.wrappedNativeTokenAddress,
  };
  const dexHelper = {
    config: {
      data: {
        network: input.network,
        augustusV6Address: input.augustusV6Address,
        wrappedNativeTokenAddress: input.wrappedNativeTokenAddress,
        executorsAddresses,
      },
      isWETH: (address: string) =>
        address.toLowerCase() === input.wrappedNativeTokenAddress,
    },
    getLogger: createNoOpLogger,
  } as any;
  const context = createExecutorEncodingContextFromDexHelper(dexHelper);

  return {
    bytecodeBuilder: createExecutorBytecodeBuilder(input.executorType, context),
    augustusV6Interface: AUGUSTUS_V6_INTERFACE,
  };
}

export function createDirectResolvedBuildDeps(
  _input: DirectBuildInput,
): ResolvedDirectBuildDeps {
  return {
    augustusV6Interface: AUGUSTUS_V6_INTERFACE,
  };
}

function createNoOpLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
