import type { IDexHelper } from '../../dex-helper';
import { ConfigHelper, generateConfig } from '../../config';
import { Network } from '../../constants';
import { DexExchangeBuildParam } from '../../types';

const SNAPSHOT_TEST_MASTER_CACHE_PREFIX = 'snapshot-tests';

export function asDexExchangeBuildParams(
  exchangeParams: unknown,
): DexExchangeBuildParam[] {
  if (!Array.isArray(exchangeParams)) {
    throw new Error(
      'Expected executor snapshot exchange params to be an array',
    );
  }

  exchangeParams.forEach((exchangeParam, index) => {
    if (
      typeof (exchangeParam as { needWrapNative?: unknown }).needWrapNative !==
      'boolean'
    ) {
      throw new Error(
        `Expected executor snapshot exchange param ${index} to have boolean needWrapNative`,
      );
    }
  });

  return exchangeParams as DexExchangeBuildParam[];
}

function createNoOpLogger(): ReturnType<IDexHelper['getLogger']> {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as ReturnType<IDexHelper['getLogger']>;
}

export function createExecutorDexHelper(network: Network): IDexHelper {
  return {
    config: new ConfigHelper(
      false,
      generateConfig(network),
      // masterCachePrefix is unused by these snapshot tests.
      SNAPSHOT_TEST_MASTER_CACHE_PREFIX,
    ),
    getLogger: () => createNoOpLogger(),
  } as unknown as IDexHelper;
}
