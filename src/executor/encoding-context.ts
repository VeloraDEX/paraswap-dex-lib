import type { IDexHelper } from '../dex-helper';
import type {
  ExecutorEncodingContext,
  ExecutorEncodingLogger,
} from './encoding-types';
import type { Address } from '../types';
import { Executors } from './types';

export function createNoopExecutorEncodingLogger(): ExecutorEncodingLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

export function createExecutorEncodingContextFromDexHelper(
  dexHelper: IDexHelper,
): ExecutorEncodingContext {
  const logger = dexHelper.getLogger('ExecutorBytecodeBuilder');
  const wrappedNativeTokenAddress = normalizeRequiredAddress(
    dexHelper.config.data.wrappedNativeTokenAddress,
    'wrappedNativeTokenAddress',
  );
  assertConfiguredWethExecutorAddress(
    dexHelper.config.data.executorsAddresses?.[Executors.WETH],
    wrappedNativeTokenAddress,
  );
  const augustusV6Address = normalizeRequiredAddress(
    dexHelper.config.data.augustusV6Address,
    'augustusV6Address',
  );

  return {
    network: dexHelper.config.data.network,
    augustusV6Address,
    wrappedNativeTokenAddress,
    executorsAddresses: {
      [Executors.ONE]: normalizeRequiredAddress(
        dexHelper.config.data.executorsAddresses?.[Executors.ONE],
        `executorsAddresses.${Executors.ONE}`,
      ),
      [Executors.TWO]: normalizeRequiredAddress(
        dexHelper.config.data.executorsAddresses?.[Executors.TWO],
        `executorsAddresses.${Executors.TWO}`,
      ),
      [Executors.THREE]: normalizeRequiredAddress(
        dexHelper.config.data.executorsAddresses?.[Executors.THREE],
        `executorsAddresses.${Executors.THREE}`,
      ),
      [Executors.WETH]: wrappedNativeTokenAddress,
    },
    // Keep method bindings: some logger implementations depend on `this`.
    logger: {
      debug: logger.debug.bind(logger),
      info: logger.info.bind(logger),
      warn: logger.warn.bind(logger),
      error: logger.error.bind(logger),
    },
  };
}

function normalizeRequiredAddress(
  address: Address | undefined,
  fieldName: string,
): Address {
  if (!address) {
    throw new Error(`${fieldName} is required`);
  }

  return normalizeAddress(address);
}

function assertConfiguredWethExecutorAddress(
  configuredWethExecutorAddress: Address | undefined,
  wrappedNativeTokenAddress: Address,
): void {
  if (
    configuredWethExecutorAddress &&
    normalizeAddress(configuredWethExecutorAddress) !==
      normalizeAddress(wrappedNativeTokenAddress)
  ) {
    throw new Error(
      `executorsAddresses.${Executors.WETH} must match wrappedNativeTokenAddress`,
    );
  }
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase();
}
