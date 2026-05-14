import type { IDexHelper } from '../../dex-helper';
import { ConfigHelper, generateConfig } from '../../config';
import { Network } from '../../constants';
import { Address, DexExchangeBuildParam } from '../../types';
import type { DepositWithdrawReturn } from '../../dex/weth/types';
import { createExecutorEncodingContextFromDexHelper } from '../encoding-context';
import type {
  ExecutorBytecodeBuildInput,
  ExecutorEncodingContext,
} from '../encoding-types';
import { buildRoutePlan, walkRoutePlan } from '../route-plan';
import type { OptimalRate } from '@paraswap/core';

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
  // Snapshot tests use generated network config so encoded addresses match the
  // executor fixtures they lock.
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

export function createExecutorSnapshotContext(
  network: Network,
): ExecutorEncodingContext {
  return createExecutorEncodingContextFromDexHelper(
    createExecutorDexHelper(network),
  );
}

export function buildExecutorSnapshotInput(
  priceRoute: OptimalRate,
  exchangeParams: DexExchangeBuildParam[],
  sender: Address,
  wethPlan?: DepositWithdrawReturn,
): ExecutorBytecodeBuildInput {
  const routePlan = buildRoutePlan(priceRoute);
  const routePositions = walkRoutePlan(routePlan);

  if (exchangeParams.length !== routePositions.length) {
    throw new Error('exchange params length must match route positions');
  }

  return {
    routePlan,
    resolvedLegs: routePositions.map((routePosition, index) => ({
      routeIndex: routePosition.routeIndex,
      swapIndex: routePosition.swapIndex,
      swapExchangeIndex: routePosition.swapExchangeIndex,
      exchangeParam: exchangeParams[index],
      // Executor bytecode snapshots only consume route positions and
      // exchangeParam; these resolved fields are placeholders.
      normalizedSrcToken: routePosition.swap.srcToken,
      normalizedDestToken: routePosition.swap.destToken,
      normalizedSrcAmount: routePosition.swapExchange.srcAmount,
      normalizedDestAmount: routePosition.swapExchange.destAmount,
      recipient: sender.toLowerCase(),
    })),
    sender,
    srcToken: priceRoute.srcToken.toLowerCase(),
    destToken: priceRoute.destToken.toLowerCase(),
    destAmount: priceRoute.destAmount,
    wethPlan,
  };
}
