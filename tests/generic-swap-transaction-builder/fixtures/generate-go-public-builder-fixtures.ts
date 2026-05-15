import depsContract from './resolved-build-deps-contract.json';
import { GenericSwapTransactionBuilder } from '../../../src/generic-swap-transaction-builder';
import { buildDexExchangeApprovalRequests } from '../../../src/generic-swap-transaction-builder/orchestration';
import {
  buildRoutePlan,
  routePositionKey,
  walkRoutePlan,
  type BuildInput,
} from '../../../src/generic-swap-transaction-builder/resolved';
import { Executors } from '../../../src/executor/types';
import type {
  DexExchangeBuildParam,
  OptimalSwap,
  OptimalSwapExchange,
  TxObject,
} from '../../../src/types';
import type {
  DexEncoderPort,
  DexEncoderRegistryPort,
  NeedWrapNativeInput,
} from '../../../src/generic-swap-transaction-builder/dex-encoder';
import { loadResolvedBuildFixtures } from './resolved-build-loader';
import type { ResolvedBuildSuccessFixture } from './resolved-build-schema';
import {
  stableStringify,
  type BuildRequestJson,
  type ExpectedApprovalRequestJson,
  type ExpectedDexCallJson,
  type GoPublicBuilderFixture,
  type PriceRouteJson,
} from './go-public-builder-schema';
import { writeGoPublicBuilderFixtures } from './go-public-builder-loader';

const PHASE_2_FIXTURE_NAMES = [
  'executor01-simple-sell-approved',
  'executor01-simple-sell-approval-missing',
  'edge-zero-quoted-amount',
  'edge-nonempty-permit',
  'executor01-eth-weth-deposit',
  'executor01-weth-eth-withdraw',
  'weth-only-eth-to-weth',
  'executor02-multiswap-sell',
  'executor02-vertical-branch-sell',
  'executor02-megaswap-sell',
  'executor03-buy',
];

type PublicBuilderOptimalSwap = OptimalSwap & {
  srcAmount?: string;
  destAmount?: string;
};

async function main(): Promise<void> {
  writeGoPublicBuilderFixtures(await buildPhase2Fixtures());
}

export async function buildPhase2Fixtures(): Promise<GoPublicBuilderFixture[]> {
  const fixtures = await Promise.all(
    PHASE_2_FIXTURE_NAMES.map(name =>
      buildFixtureFromResolvedFixture(findResolvedGenericFixture(name)),
    ),
  );

  fixtures.push(
    await buildNoSwapAmountsFixture(
      findResolvedGenericFixture('executor01-simple-sell-approved'),
    ),
    await buildEmptyQuotedAmountFixture(
      findResolvedGenericFixture('executor01-simple-sell-approved'),
    ),
  );

  return fixtures;
}

function findResolvedGenericFixture(name: string): ResolvedBuildSuccessFixture {
  const fixture = loadResolvedBuildFixtures()
    .map(entry => entry.fixture)
    .find(
      (candidate): candidate is ResolvedBuildSuccessFixture =>
        candidate.name === name && candidate.kind === 'generic',
    );

  if (!fixture) {
    throw new Error(`missing resolved generic fixture ${name}`);
  }
  if (!fixture.orchestration?.priceRoute) {
    throw new Error(`${name}: missing orchestration priceRoute`);
  }

  return fixture;
}

async function buildFixtureFromResolvedFixture(
  fixture: ResolvedBuildSuccessFixture,
  overrides: {
    name?: string;
    description?: string;
    mutateRequest?: (request: BuildRequestJson) => void;
  } = {},
): Promise<GoPublicBuilderFixture> {
  const input = fixture.input as BuildInput;
  const request = buildRequestFromResolvedFixture(fixture);
  overrides.mutateRequest?.(request);
  const replay = await replayPublicBuilderForGoFixture(
    fixture.name,
    fixture,
    request,
  );

  assertJsonEqual(
    replay.expectedResolvedInput,
    input,
    `${fixture.name}: public BuildInput parity failed`,
  );

  return {
    schemaVersion: 1,
    name: overrides.name ?? fixture.name,
    description:
      overrides.description ??
      `Public generic builder contract fixture recorded from ${fixture.name}.`,
    kind: 'generic-public',
    dexKeys: [...new Set(collectDexKeys(request.priceRoute))].sort(),
    input: {
      request,
      options: {
        skipApprovalCheck: false,
      },
    },
    expectedResolvedInput: replay.expectedResolvedInput,
    expectedParams: replay.expectedParams,
    expectedTx: replay.expectedTx,
    expectedDexCalls: replay.expectedDexCalls,
    expectedApprovalRequests: replay.expectedApprovalRequests,
    approvalDecisions: replay.approvalDecisions,
  };
}

function buildRequestFromResolvedFixture(
  fixture: ResolvedBuildSuccessFixture,
): BuildRequestJson {
  const input = fixture.input as BuildInput;
  const fee = input.fee as BuildInput['fee'] & {
    partnerAddress: string;
    partnerFeePercent: string;
    referrerAddress?: string;
    takeSurplus: boolean;
    isCapSurplus: boolean;
    isSurplusToUser: boolean;
    isDirectFeeTransfer: boolean;
  };
  const priceRoute = toPublicPriceRoute(fixture.orchestration!.priceRoute);
  const request: BuildRequestJson = {
    priceRoute,
    minMaxAmount: fixture.orchestration?.minMaxAmount ?? input.minMaxAmount,
    userAddress: input.userAddress,
    partnerAddress: fee.partnerAddress,
    partnerFeePercent: fee.partnerFeePercent,
    takeSurplus: fee.takeSurplus,
    isSurplusToUser: fee.isSurplusToUser,
    isDirectFeeTransfer: fee.isDirectFeeTransfer,
    deadline: '0',
    uuid: input.uuid,
  };

  if (fixture.orchestration?.quotedAmount !== undefined) {
    request.quotedAmount = fixture.orchestration.quotedAmount;
  }
  if (fee.referrerAddress !== undefined) {
    request.referrerAddress = fee.referrerAddress;
  }
  if (fee.isCapSurplus !== true) {
    request.isCapSurplus = fee.isCapSurplus;
  }
  if (input.gas?.gasPrice) {
    request.gasPrice = input.gas.gasPrice;
  }
  if (input.gas?.maxFeePerGas) {
    request.maxFeePerGas = input.gas.maxFeePerGas;
  }
  if (input.gas?.maxPriorityFeePerGas) {
    request.maxPriorityFeePerGas = input.gas.maxPriorityFeePerGas;
  }
  if (input.permit !== '0x') {
    request.permit = input.permit;
  }
  if (input.beneficiary !== '0x0000000000000000000000000000000000000000') {
    request.beneficiary = input.beneficiary;
  }

  return request;
}

async function buildNoSwapAmountsFixture(
  sourceFixture: ResolvedBuildSuccessFixture,
): Promise<GoPublicBuilderFixture> {
  return buildFixtureFromResolvedFixture(sourceFixture, {
    name: 'executor01-simple-sell-no-swap-amounts',
    description:
      'Public generic builder contract fixture with swap-level amounts omitted.',
    mutateRequest: request => {
      request.priceRoute.bestRoute.forEach(route => {
        route.swaps.forEach(swap => {
          delete swap.srcAmount;
          delete swap.destAmount;
        });
      });
    },
  });
}

async function buildEmptyQuotedAmountFixture(
  sourceFixture: ResolvedBuildSuccessFixture,
): Promise<GoPublicBuilderFixture> {
  return buildFixtureFromResolvedFixture(sourceFixture, {
    name: 'executor01-simple-sell-empty-quoted-amount',
    description:
      'Public generic builder contract fixture with empty quotedAmount defaulting to priceRoute.destAmount.',
    mutateRequest: request => {
      request.quotedAmount = '';
    },
  });
}

function toPublicPriceRoute(priceRoute: any): PriceRouteJson {
  return {
    network: priceRoute.network,
    blockNumber: priceRoute.blockNumber,
    contractMethod: priceRoute.contractMethod,
    side: priceRoute.side,
    srcToken: priceRoute.srcToken,
    destToken: priceRoute.destToken,
    srcAmount: priceRoute.srcAmount,
    destAmount: priceRoute.destAmount,
    bestRoute: priceRoute.bestRoute.map((route: any) => ({
      percent: route.percent,
      swaps: route.swaps.map((swap: PublicBuilderOptimalSwap) => ({
        srcToken: swap.srcToken,
        destToken: swap.destToken,
        srcAmount: swap.srcAmount,
        destAmount: swap.destAmount,
        swapExchanges: swap.swapExchanges.map(
          (swapExchange: OptimalSwapExchange<any>) => ({
            exchange: swapExchange.exchange,
            percent: swapExchange.percent,
            srcAmount: swapExchange.srcAmount,
            destAmount: swapExchange.destAmount,
            data: swapExchange.data,
          }),
        ),
      })),
    })),
  };
}

function collectDexKeys(priceRoute: PriceRouteJson): string[] {
  return priceRoute.bestRoute.flatMap(route =>
    route.swaps.flatMap(swap =>
      swap.swapExchanges.map(swapExchange => swapExchange.exchange),
    ),
  );
}

async function replayPublicBuilderForGoFixture(
  fixtureName: string,
  fixture: ResolvedBuildSuccessFixture,
  request: BuildRequestJson,
): Promise<{
  expectedResolvedInput: BuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
  expectedDexCalls: ExpectedDexCallJson[];
  expectedApprovalRequests: ExpectedApprovalRequestJson[];
  approvalDecisions: boolean[];
}> {
  const input = fixture.input as BuildInput;
  const approvalDecisions = fixture.orchestration?.approvalDecisions ?? [];
  const txRun = await runRecordedPublicBuilder({
    fixtureName,
    request,
    input,
    exchangeParams: fixture.orchestration?.exchangeParams ?? [],
    approvalDecisions,
    onlyParams: false,
  });
  const paramsRun = await runRecordedPublicBuilder({
    fixtureName,
    request,
    input,
    exchangeParams: fixture.orchestration?.exchangeParams ?? [],
    approvalDecisions,
    onlyParams: true,
  });

  assertJsonEqual(
    paramsRun.buildInput,
    txRun.buildInput,
    `${fixtureName}: public BuildInput changed between tx and onlyParams builds`,
  );
  assertJsonEqual(
    paramsRun.expectedDexCalls,
    txRun.expectedDexCalls,
    `${fixtureName}: DEX observations changed between tx and onlyParams builds`,
  );
  assertJsonEqual(
    paramsRun.expectedApprovalRequests,
    txRun.expectedApprovalRequests,
    `${fixtureName}: approval observations changed between tx and onlyParams builds`,
  );

  return {
    expectedResolvedInput: txRun.buildInput,
    expectedParams: paramsRun.result as unknown[],
    expectedTx: txRun.result as TxObject,
    expectedDexCalls: txRun.expectedDexCalls,
    expectedApprovalRequests: txRun.expectedApprovalRequests,
    approvalDecisions,
  };
}

async function runRecordedPublicBuilder({
  fixtureName,
  request,
  input,
  exchangeParams,
  approvalDecisions,
  onlyParams,
}: {
  fixtureName: string;
  request: BuildRequestJson;
  input: BuildInput;
  exchangeParams: DexExchangeBuildParam[];
  approvalDecisions: boolean[];
  onlyParams: boolean;
}): Promise<{
  result: TxObject | unknown[];
  buildInput: BuildInput;
  expectedDexCalls: ExpectedDexCallJson[];
  expectedApprovalRequests: ExpectedApprovalRequestJson[];
}> {
  const dexRegistry = new RecordingDexRegistry(
    request.priceRoute,
    exchangeParams,
  );
  let recordedApprovalPairs: [string, string, boolean][] | undefined;
  const dexAdapterService = buildRecordingDexAdapterService({
    request,
    input,
    approvalDecisions,
    recordApprovalPairs: pairs => {
      recordedApprovalPairs = pairs;
    },
  });
  const capturedBuildInputs: BuildInput[] = [];
  const builder = new GenericSwapTransactionBuilder(dexAdapterService, {
    dexEncoderRegistry: dexRegistry,
    resolvedBuildInputObserver: {
      onGenericBuildInput: buildInput =>
        capturedBuildInputs.push(clone(buildInput)),
    },
  });
  const result = (await builder.build({
    ...request,
    onlyParams,
  } as any)) as TxObject | unknown[];
  const buildInput = getSingleCapturedBuildInput(
    capturedBuildInputs,
    `${fixtureName}: expected one captured generic BuildInput`,
  );
  const expectedDexCalls = dexRegistry.expectedDexCalls();
  const expectedApprovalRequests = buildExpectedApprovalRequests(
    fixtureName,
    request.priceRoute,
    buildInput,
    recordedApprovalPairs,
  );

  if (approvalDecisions.length !== expectedApprovalRequests.length) {
    throw new Error(
      `${fixtureName}: approval decision length must match expected approval request count`,
    );
  }

  return {
    result,
    buildInput,
    expectedDexCalls,
    expectedApprovalRequests,
  };
}

function buildExpectedApprovalRequests(
  fixtureName: string,
  priceRoute: PriceRouteJson,
  input: BuildInput,
  recordedApprovalPairs: [string, string, boolean][] | undefined,
): ExpectedApprovalRequestJson[] {
  const requests = buildDexExchangeApprovalRequests({
    executorEncodingContext: {
      wrappedNativeTokenAddress: input.wrappedNativeTokenAddress,
    } as any,
    priceRoute: priceRoute as any,
    routePlan: input.routePlan,
    resolvedLegs: input.resolvedLegs,
  });
  const pairs = requests.map(request => request.params);

  if (recordedApprovalPairs !== undefined) {
    assertJsonEqual(
      recordedApprovalPairs,
      pairs,
      `${fixtureName}: approval checker input parity failed`,
    );
  } else if (pairs.length !== 0) {
    throw new Error(`${fixtureName}: approval checker was not called`);
  }

  return requests.map(request => {
    const [token, target, permit2] = request.params;

    return {
      routePositionKey: request.routePositionKey,
      token: normalizeAddress(token),
      target: normalizeAddress(target),
      permit2,
    };
  });
}

class RecordingDexRegistry implements DexEncoderRegistryPort {
  private readonly paramsByRoutePositionKey = new Map<
    string,
    DexExchangeBuildParam
  >();
  private readonly records: Partial<ExpectedDexCallJson>[] = [];
  private readonly recordByRoutePositionKey = new Map<
    string,
    Partial<ExpectedDexCallJson>
  >();

  constructor(
    priceRoute: PriceRouteJson,
    exchangeParams: DexExchangeBuildParam[],
  ) {
    const routePositions = walkRoutePlan(buildRoutePlan(priceRoute as any));

    if (exchangeParams.length !== routePositions.length) {
      throw new Error(
        `exchange param count ${exchangeParams.length} does not match route leg count ${routePositions.length}`,
      );
    }

    routePositions.forEach((routePosition, index) => {
      this.paramsByRoutePositionKey.set(
        routePositionKey(routePosition),
        stripFixtureOnlyDexFields(exchangeParams[index]),
      );
    });
  }

  getDexEncoder({
    dexKey,
  }: {
    network: number;
    dexKey: string;
  }): DexEncoderPort {
    return {
      needWrapNative: input => {
        const key = routePositionKeyFromInput(input);
        const dexParam = this.dexParamForKey(key);
        const record = this.recordForKey(key);

        assertDexKey(dexKey, input.swapExchange.exchange, key);
        record.routePositionKey = key;
        record.dexKey = dexKey;
        record.needWrapNativeInput = clone(input);
        record.needWrapNative = dexParam.needWrapNative;

        return dexParam.needWrapNative;
      },
      getDexParam: input => {
        const key = routePositionKeyFromInput(input);
        const dexParam = this.dexParamForKey(key);
        const record = this.recordForKey(key);

        assertDexKey(dexKey, input.dexKey, key);
        record.routePositionKey = key;
        record.dexKey = dexKey;
        record.dexParamInput = clone(input);
        record.dexParam = clone(dexParam) as any;

        return clone(dexParam) as any;
      },
    };
  }

  getDirectDexEncoder(): never {
    throw new Error('direct DEX encoder lookup is out of scope');
  }

  expectedDexCalls(): ExpectedDexCallJson[] {
    return this.records.map((record, index) => {
      if (
        record.routePositionKey === undefined ||
        record.dexKey === undefined ||
        record.needWrapNativeInput === undefined ||
        record.needWrapNative === undefined ||
        record.dexParamInput === undefined ||
        record.dexParam === undefined
      ) {
        throw new Error(`incomplete recorded DEX call at index ${index}`);
      }

      return record as ExpectedDexCallJson;
    });
  }

  private dexParamForKey(key: string): DexExchangeBuildParam {
    const dexParam = this.paramsByRoutePositionKey.get(key);

    if (!dexParam) {
      throw new Error(`missing DEX param for route position ${key}`);
    }

    return dexParam;
  }

  private recordForKey(key: string): Partial<ExpectedDexCallJson> {
    let record = this.recordByRoutePositionKey.get(key);

    if (!record) {
      record = {};
      this.recordByRoutePositionKey.set(key, record);
      this.records.push(record);
    }

    return record;
  }
}

function buildRecordingDexAdapterService({
  request,
  input,
  approvalDecisions,
  recordApprovalPairs,
}: {
  request: BuildRequestJson;
  input: BuildInput;
  approvalDecisions: boolean[];
  recordApprovalPairs: (pairs: [string, string, boolean][]) => void;
}) {
  return {
    network: request.priceRoute.network,
    dexHelper: {
      config: {
        data: {
          network: request.priceRoute.network,
          augustusV6Address: input.augustusV6Address,
          wrappedNativeTokenAddress: input.wrappedNativeTokenAddress,
          executorsAddresses: {
            [Executors.ONE]: depsContract.executorsAddresses.Executor01,
            [Executors.TWO]: depsContract.executorsAddresses.Executor02,
            [Executors.THREE]: depsContract.executorsAddresses.Executor03,
            [Executors.WETH]: input.wrappedNativeTokenAddress,
          },
        },
        isWETH: (token: string) =>
          token.toLowerCase() === input.wrappedNativeTokenAddress,
      },
      augustusApprovals: {
        hasApprovals: async (
          _spender: string,
          pairs: [string, string, boolean][],
        ) => {
          recordApprovalPairs(clone(pairs));
          if (approvalDecisions.length !== pairs.length) {
            throw new Error(
              `approval decision length ${approvalDecisions.length} does not match approval pair count ${pairs.length}`,
            );
          }

          return approvalDecisions;
        },
      },
      getLogger: () => ({
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      }),
    },
    isDirectFunctionNameV6: () => false,
    getTxBuilderDexByKey: (dexKey: string) => {
      throw new Error(`unexpected legacy DEX lookup in fixture: ${dexKey}`);
    },
  } as any;
}

function routePositionKeyFromInput(input: NeedWrapNativeInput): string {
  return routePositionKey({
    routeIndex: input.route.routeIndex,
    swapIndex: input.swap.swapIndex,
    swapExchangeIndex: input.swapExchange.swapExchangeIndex,
  });
}

function assertDexKey(expected: string, got: string, key: string): void {
  if (got !== expected) {
    throw new Error(
      `${key}: dexKey mismatch during recording: got ${got}, want ${expected}`,
    );
  }
}

function getSingleCapturedBuildInput(
  capturedInputs: BuildInput[],
  message: string,
): BuildInput {
  if (capturedInputs.length !== 1) {
    throw new Error(`${message}: got ${capturedInputs.length}`);
  }

  return capturedInputs[0];
}

function stripFixtureOnlyDexFields(
  exchangeParam: DexExchangeBuildParam,
): DexExchangeBuildParam {
  const normalized = clone(exchangeParam) as DexExchangeBuildParam &
    Record<string, unknown>;

  delete normalized.dexFuncHasDestToken;

  return normalized;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function assertJsonEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const actualJson = stableStringify(actual);
  const expectedJson = stableStringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}\nactual: ${actualJson}\nexpected: ${expectedJson}`,
    );
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

if (require.main === module) {
  main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
