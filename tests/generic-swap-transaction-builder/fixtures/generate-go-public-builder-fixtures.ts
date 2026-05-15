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
import { ETHER_ADDRESS, Network } from '../../../src/constants';
import { Tessera } from '../../../src/dex/tessera/tessera';
import { Tokens } from '../../../tests/constants-e2e';
import type {
  Address,
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
import { createTsDexEncoderRegistry } from '../../../src/generic-swap-transaction-builder/dex-encoder';
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

const TESSERA_PUBLIC_FIXTURE_CASES: TesseraPublicFixtureCase[] = [
  {
    name: 'tessera-base-usdc-to-weth-sell',
    network: Network.BASE,
    blockNumber: 45600823,
    srcToken: lowerAddress(Tokens[Network.BASE].USDC.address),
    srcDecimals: Tokens[Network.BASE].USDC.decimals,
    srcAmount: '1000000',
    destToken: lowerAddress(Tokens[Network.BASE].WETH.address),
    destDecimals: Tokens[Network.BASE].WETH.decimals,
    destAmount: '420526831788390',
    side: 'SELL',
  },
  {
    name: 'tessera-base-usdc-to-eth-sell',
    network: Network.BASE,
    blockNumber: 45600823,
    srcToken: lowerAddress(Tokens[Network.BASE].USDC.address),
    srcDecimals: Tokens[Network.BASE].USDC.decimals,
    srcAmount: '1000000',
    destToken: lowerAddress(ETHER_ADDRESS),
    destDecimals: Tokens[Network.BASE].WETH.decimals,
    destAmount: '420526831788390',
    side: 'SELL',
  },
  {
    name: 'tessera-base-weth-to-usdc-sell',
    network: Network.BASE,
    blockNumber: 45600823,
    srcToken: lowerAddress(Tokens[Network.BASE].WETH.address),
    srcDecimals: Tokens[Network.BASE].WETH.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BASE].USDC.address),
    destDecimals: Tokens[Network.BASE].USDC.decimals,
    destAmount: '2377679443',
    side: 'SELL',
  },
  {
    name: 'tessera-base-eth-to-usdc-sell',
    network: Network.BASE,
    blockNumber: 45600823,
    srcToken: lowerAddress(ETHER_ADDRESS),
    srcDecimals: Tokens[Network.BASE].WETH.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BASE].USDC.address),
    destDecimals: Tokens[Network.BASE].USDC.decimals,
    destAmount: '2377679443',
    side: 'SELL',
  },
  {
    name: 'tessera-base-usdc-to-weth-buy',
    network: Network.BASE,
    blockNumber: 45600823,
    srcToken: lowerAddress(Tokens[Network.BASE].USDC.address),
    srcDecimals: Tokens[Network.BASE].USDC.decimals,
    srcAmount: '1000000',
    destToken: lowerAddress(Tokens[Network.BASE].WETH.address),
    destDecimals: Tokens[Network.BASE].WETH.decimals,
    destAmount: '420526831788390',
    side: 'BUY',
  },
  {
    name: 'tessera-base-usdc-to-eth-buy',
    network: Network.BASE,
    blockNumber: 45600823,
    srcToken: lowerAddress(Tokens[Network.BASE].USDC.address),
    srcDecimals: Tokens[Network.BASE].USDC.decimals,
    srcAmount: '1000000',
    destToken: lowerAddress(ETHER_ADDRESS),
    destDecimals: Tokens[Network.BASE].WETH.decimals,
    destAmount: '420526831788390',
    side: 'BUY',
  },
  {
    name: 'tessera-bsc-wbnb-to-usdt-sell',
    network: Network.BSC,
    blockNumber: 96572572,
    srcToken: lowerAddress(Tokens[Network.BSC].WBNB.address),
    srcDecimals: Tokens[Network.BSC].WBNB.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BSC].USDT.address),
    destDecimals: Tokens[Network.BSC].USDT.decimals,
    destAmount: '631755922471100996711',
    side: 'SELL',
  },
  {
    name: 'tessera-bsc-bnb-to-usdt-sell',
    network: Network.BSC,
    blockNumber: 96572572,
    srcToken: lowerAddress(ETHER_ADDRESS),
    srcDecimals: Tokens[Network.BSC].WBNB.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BSC].USDT.address),
    destDecimals: Tokens[Network.BSC].USDT.decimals,
    destAmount: '631755922471100996711',
    side: 'SELL',
  },
  {
    name: 'tessera-bsc-usdt-to-wbnb-sell',
    network: Network.BSC,
    blockNumber: 96572572,
    srcToken: lowerAddress(Tokens[Network.BSC].USDT.address),
    srcDecimals: Tokens[Network.BSC].USDT.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BSC].WBNB.address),
    destDecimals: Tokens[Network.BSC].WBNB.decimals,
    destAmount: '1582521639071061',
    side: 'SELL',
  },
  {
    name: 'tessera-bsc-usdt-to-bnb-sell',
    network: Network.BSC,
    blockNumber: 96572572,
    srcToken: lowerAddress(Tokens[Network.BSC].USDT.address),
    srcDecimals: Tokens[Network.BSC].USDT.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(ETHER_ADDRESS),
    destDecimals: Tokens[Network.BSC].WBNB.decimals,
    destAmount: '1582521639071061',
    side: 'SELL',
  },
  {
    name: 'tessera-bsc-wbnb-to-usdt-buy',
    network: Network.BSC,
    blockNumber: 96572572,
    srcToken: lowerAddress(Tokens[Network.BSC].WBNB.address),
    srcDecimals: Tokens[Network.BSC].WBNB.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BSC].USDT.address),
    destDecimals: Tokens[Network.BSC].USDT.decimals,
    destAmount: '631755922471100996711',
    side: 'BUY',
  },
  {
    name: 'tessera-bsc-bnb-to-usdt-buy',
    network: Network.BSC,
    blockNumber: 96572572,
    srcToken: lowerAddress(ETHER_ADDRESS),
    srcDecimals: Tokens[Network.BSC].WBNB.decimals,
    srcAmount: '1000000000000000000',
    destToken: lowerAddress(Tokens[Network.BSC].USDT.address),
    destDecimals: Tokens[Network.BSC].USDT.decimals,
    destAmount: '631755922471100996711',
    side: 'BUY',
  },
];

type PublicBuilderOptimalSwap = OptimalSwap & {
  srcAmount?: string;
  destAmount?: string;
};

type TesseraPublicFixtureCase = {
  name: string;
  network: number;
  blockNumber: number;
  srcToken: Address;
  srcDecimals: number;
  srcAmount: string;
  destToken: Address;
  destDecimals: number;
  destAmount: string;
  side: 'SELL' | 'BUY';
};

type PublicBuilderAdapterContext = {
  network: number;
  augustusV6Address: Address;
  wrappedNativeTokenAddress: Address;
};

type RecordingPublicDexRegistry = DexEncoderRegistryPort & {
  expectedDexCalls(): ExpectedDexCallJson[];
};

async function main(): Promise<void> {
  writeGoPublicBuilderFixtures(await buildPublicBuilderFixtures());
}

export async function buildPublicBuilderFixtures(): Promise<
  GoPublicBuilderFixture[]
> {
  return [
    ...(await buildPhase2Fixtures()),
    ...(await buildTesseraPublicFixtures()),
  ];
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

async function buildTesseraPublicFixtures(): Promise<GoPublicBuilderFixture[]> {
  return Promise.all(
    TESSERA_PUBLIC_FIXTURE_CASES.map(buildTesseraPublicFixture),
  );
}

async function buildTesseraPublicFixture(
  testCase: TesseraPublicFixtureCase,
): Promise<GoPublicBuilderFixture> {
  const request = buildTesseraBuildRequest(testCase);
  const replay = await replayPublicBuilderForTesseraFixture(
    testCase.name,
    request,
  );

  return {
    schemaVersion: 1,
    name: testCase.name,
    description: `Public generic builder contract fixture recorded from a real TypeScript Tessera public builder run for ${testCase.name}.`,
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

function buildTesseraBuildRequest(
  testCase: TesseraPublicFixtureCase,
): BuildRequestJson {
  const priceRoute = buildTesseraPriceRoute(testCase);

  return {
    priceRoute,
    minMaxAmount:
      testCase.side === 'SELL' ? testCase.destAmount : testCase.srcAmount,
    userAddress: '0x1111111111111111111111111111111111111111',
    partnerAddress: '0x0000000000000000000000000000000000000000',
    partnerFeePercent: '0',
    takeSurplus: false,
    isSurplusToUser: false,
    isDirectFeeTransfer: false,
    gasPrice: '1',
    maxFeePerGas: '2',
    maxPriorityFeePerGas: '3',
    deadline: '0',
    uuid: '11111111-1111-1111-1111-111111111111',
  };
}

function buildTesseraPriceRoute(
  testCase: TesseraPublicFixtureCase,
): PriceRouteJson {
  return toPublicPriceRoute({
    blockNumber: testCase.blockNumber,
    network: testCase.network,
    srcToken: testCase.srcToken,
    srcDecimals: testCase.srcDecimals,
    srcAmount: testCase.srcAmount,
    destToken: testCase.destToken,
    destDecimals: testCase.destDecimals,
    destAmount: testCase.destAmount,
    bestRoute: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: testCase.srcToken,
            srcDecimals: testCase.srcDecimals,
            srcAmount: testCase.srcAmount,
            destToken: testCase.destToken,
            destDecimals: testCase.destDecimals,
            destAmount: testCase.destAmount,
            swapExchanges: [
              {
                exchange: 'Tessera',
                srcAmount: testCase.srcAmount,
                destAmount: testCase.destAmount,
                percent: 100,
                poolAddresses: [],
                data: null,
              },
            ],
          },
        ],
      },
    ],
    gasCostUSD: '0',
    gasCost: '150000',
    others: [],
    side: testCase.side,
    version: '6.2',
    contractAddress: '0x6a000f20005980200259b80c5102003040001068',
    tokenTransferProxy: '0x6a000f20005980200259b80c5102003040001068',
    contractMethod:
      testCase.side === 'SELL' ? 'swapExactAmountIn' : 'swapExactAmountOut',
    partnerFee: 0,
    srcUSD: '0',
    destUSD: '0',
    partner: 'anon',
    maxImpactReached: false,
    hmac: '',
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
  const adapterContext = adapterContextFromBuildInput(input);
  const txRun = await runRecordedPublicBuilder({
    fixtureName,
    request,
    adapterContext,
    dexRegistry: new RecordingDexRegistry(
      request.priceRoute,
      fixture.orchestration?.exchangeParams ?? [],
    ),
    approvalDecisions,
    onlyParams: false,
  });
  const paramsRun = await runRecordedPublicBuilder({
    fixtureName,
    request,
    adapterContext,
    dexRegistry: new RecordingDexRegistry(
      request.priceRoute,
      fixture.orchestration?.exchangeParams ?? [],
    ),
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
  assertJsonEqual(
    paramsRun.approvalDecisions,
    txRun.approvalDecisions,
    `${fixtureName}: approval decisions changed between tx and onlyParams builds`,
  );

  return {
    expectedResolvedInput: txRun.buildInput,
    expectedParams: paramsRun.result as unknown[],
    expectedTx: txRun.result as TxObject,
    expectedDexCalls: txRun.expectedDexCalls,
    expectedApprovalRequests: txRun.expectedApprovalRequests,
    approvalDecisions: txRun.approvalDecisions,
  };
}

async function replayPublicBuilderForTesseraFixture(
  fixtureName: string,
  request: BuildRequestJson,
): Promise<{
  expectedResolvedInput: BuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
  expectedDexCalls: ExpectedDexCallJson[];
  expectedApprovalRequests: ExpectedApprovalRequestJson[];
  approvalDecisions: boolean[];
}> {
  const adapterContext = adapterContextForNetwork(request.priceRoute.network);
  const txRun = await runRecordedPublicBuilder({
    fixtureName,
    request,
    adapterContext,
    dexRegistry: buildRecordingTesseraDexRegistry(adapterContext),
    onlyParams: false,
  });
  const paramsRun = await runRecordedPublicBuilder({
    fixtureName,
    request,
    adapterContext,
    dexRegistry: buildRecordingTesseraDexRegistry(adapterContext),
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
  assertJsonEqual(
    paramsRun.approvalDecisions,
    txRun.approvalDecisions,
    `${fixtureName}: approval decisions changed between tx and onlyParams builds`,
  );

  return {
    expectedResolvedInput: txRun.buildInput,
    expectedParams: paramsRun.result as unknown[],
    expectedTx: txRun.result as TxObject,
    expectedDexCalls: txRun.expectedDexCalls,
    expectedApprovalRequests: txRun.expectedApprovalRequests,
    approvalDecisions: txRun.approvalDecisions,
  };
}

async function runRecordedPublicBuilder({
  fixtureName,
  request,
  adapterContext,
  dexRegistry,
  approvalDecisions,
  onlyParams,
}: {
  fixtureName: string;
  request: BuildRequestJson;
  adapterContext: PublicBuilderAdapterContext;
  dexRegistry: RecordingPublicDexRegistry;
  approvalDecisions?: boolean[];
  onlyParams: boolean;
}): Promise<{
  result: TxObject | unknown[];
  buildInput: BuildInput;
  expectedDexCalls: ExpectedDexCallJson[];
  expectedApprovalRequests: ExpectedApprovalRequestJson[];
  approvalDecisions: boolean[];
}> {
  let recordedApprovalPairs: [string, string, boolean][] | undefined;
  let recordedApprovalDecisions: boolean[] | undefined;
  const dexAdapterService = buildRecordingDexAdapterService({
    request,
    adapterContext,
    approvalDecisions,
    recordApprovalPairs: pairs => {
      recordedApprovalPairs = pairs;
    },
    recordApprovalDecisions: decisions => {
      recordedApprovalDecisions = decisions;
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

  const resolvedApprovalDecisions = recordedApprovalDecisions ?? [];
  if (resolvedApprovalDecisions.length !== expectedApprovalRequests.length) {
    throw new Error(
      `${fixtureName}: approval decision length must match expected approval request count`,
    );
  }

  return {
    result,
    buildInput,
    expectedDexCalls,
    expectedApprovalRequests,
    approvalDecisions: resolvedApprovalDecisions,
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
        if (record.needWrapNativeInput !== undefined) {
          throw new Error(`${key}: duplicate needWrapNative call`);
        }

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
        if (record.needWrapNativeInput === undefined) {
          throw new Error(`${key}: getDexParam called before needWrapNative`);
        }
        if (record.dexParamInput !== undefined) {
          throw new Error(`${key}: duplicate getDexParam call`);
        }

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

// Records fresh real-TypeScript encoder calls by route position. The Go-side
// recorder consumes a flat expected list; both paths enforce one
// needWrapNative/getDexParam pair per route position.
class RecordingRealDexRegistry implements DexEncoderRegistryPort {
  private readonly records: Partial<ExpectedDexCallJson>[] = [];
  private readonly recordByRoutePositionKey = new Map<
    string,
    Partial<ExpectedDexCallJson>
  >();

  constructor(private readonly inner: DexEncoderRegistryPort) {}

  async getDexEncoder(lookup: {
    network: number;
    dexKey: string;
  }): Promise<DexEncoderPort> {
    const encoder = await this.inner.getDexEncoder(lookup);

    return {
      needWrapNative: async input => {
        const key = routePositionKeyFromInput(input);
        const record = this.recordForKey(key);
        if (record.needWrapNativeInput !== undefined) {
          throw new Error(`${key}: duplicate needWrapNative call`);
        }
        const needWrapNative = await encoder.needWrapNative(input);

        assertDexKey(lookup.dexKey, input.swapExchange.exchange, key);
        record.routePositionKey = key;
        record.dexKey = lookup.dexKey;
        record.needWrapNativeInput = clone(input);
        record.needWrapNative = needWrapNative;

        return needWrapNative;
      },
      getDexParam: async input => {
        const key = routePositionKeyFromInput(input);
        const record = this.recordForKey(key);
        if (record.needWrapNativeInput === undefined) {
          throw new Error(`${key}: getDexParam called before needWrapNative`);
        }
        if (record.dexParamInput !== undefined) {
          throw new Error(`${key}: duplicate getDexParam call`);
        }
        const dexParam = await encoder.getDexParam(input);

        assertDexKey(lookup.dexKey, input.dexKey, key);
        record.routePositionKey = key;
        record.dexKey = lookup.dexKey;
        record.dexParamInput = clone(input);
        record.dexParam = clone(dexParam) as any;

        return dexParam;
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

function buildRecordingTesseraDexRegistry(
  adapterContext: PublicBuilderAdapterContext,
): RecordingPublicDexRegistry {
  const dexHelper = buildRecordingDexHelper({ adapterContext });
  // Tessera's TS encoder is class-stateless for the fields used here, so direct
  // construction plus createTsDexEncoderRegistry is equivalent to production
  // lookup. Future DEXes with adapter-mediated state should wrap a real
  // DexAdapterService instead.
  const tessera = new Tessera(dexHelper as any);
  const tesseraDexes = {
    tessera,
  };

  return new RecordingRealDexRegistry(
    createTsDexEncoderRegistry({
      network: adapterContext.network,
      getTxBuilderDexByKey: dexKey => {
        const dex = tesseraDexes[dexKey.toLowerCase() as 'tessera'];
        if (!dex) throw new Error(`missing Tessera test dex ${dexKey}`);
        return dex as any;
      },
    }),
  );
}

function buildRecordingDexAdapterService({
  request,
  adapterContext,
  approvalDecisions,
  recordApprovalPairs,
  recordApprovalDecisions,
}: {
  request: BuildRequestJson;
  adapterContext: PublicBuilderAdapterContext;
  approvalDecisions?: boolean[];
  recordApprovalPairs: (pairs: [string, string, boolean][]) => void;
  recordApprovalDecisions: (decisions: boolean[]) => void;
}) {
  const dexHelper = buildRecordingDexHelper({
    adapterContext,
    approvalDecisions,
    recordApprovalPairs,
    recordApprovalDecisions,
  });

  return {
    network: request.priceRoute.network,
    dexHelper,
    isDirectFunctionNameV6: () => false,
    getTxBuilderDexByKey: (dexKey: string) => {
      throw new Error(`unexpected legacy DEX lookup in fixture: ${dexKey}`);
    },
  } as any;
}

function buildRecordingDexHelper({
  adapterContext,
  approvalDecisions,
  recordApprovalPairs,
  recordApprovalDecisions,
}: {
  adapterContext: PublicBuilderAdapterContext;
  approvalDecisions?: boolean[];
  recordApprovalPairs?: (pairs: [string, string, boolean][]) => void;
  recordApprovalDecisions?: (decisions: boolean[]) => void;
}) {
  class DummyContract {}

  // Minimal IDexHelper surface for GenericSwapTransactionBuilder and Tessera:
  // config.data, config.wrapETH/isWETH, web3Provider.eth.Contract,
  // augustusApprovals, cache/http/logger stubs.
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
  };

  return {
    config: {
      data: {
        network: adapterContext.network,
        augustusAddress: adapterContext.augustusV6Address,
        augustusV6Address: adapterContext.augustusV6Address,
        augustusRFQAddress: '0x0000000000000000000000000000000000000000',
        wrappedNativeTokenAddress: adapterContext.wrappedNativeTokenAddress,
        tokenTransferProxyAddress: '0x0000000000000000000000000000000000000000',
        multicallV2Address: '0x0000000000000000000000000000000000000000',
        adapterAddresses: {},
        executorsAddresses: {
          [Executors.ONE]: depsContract.executorsAddresses.Executor01,
          [Executors.TWO]: depsContract.executorsAddresses.Executor02,
          [Executors.THREE]: depsContract.executorsAddresses.Executor03,
          [Executors.WETH]: adapterContext.wrappedNativeTokenAddress,
        },
        rfqConfigs: {},
        apiKeyTheGraph: '',
      },
      isWETH: (token: string) =>
        token.toLowerCase() === adapterContext.wrappedNativeTokenAddress,
      wrapETH: (token: any) => {
        if (typeof token === 'string') {
          return lowerAddress(token) === lowerAddress(ETHER_ADDRESS)
            ? adapterContext.wrappedNativeTokenAddress
            : lowerAddress(token);
        }

        return lowerAddress(token.address) === lowerAddress(ETHER_ADDRESS)
          ? {
              ...token,
              address: adapterContext.wrappedNativeTokenAddress,
              decimals: 18,
            }
          : {
              ...token,
              address: lowerAddress(token.address),
            };
      },
    },
    web3Provider: {
      eth: {
        Contract: DummyContract,
        handleRevert: false,
      },
    },
    provider: {},
    httpRequest: {
      request: async () => undefined,
      querySubgraph: async () => ({ data: {} }),
    },
    cache: {
      get: async () => null,
      setex: async () => undefined,
      rawget: async () => null,
      rawset: async () => 'OK',
    },
    augustusApprovals: {
      hasApprovals: async (
        _spender: string,
        pairs: [string, string, boolean][],
      ) => {
        recordApprovalPairs?.(clone(pairs));
        const decisions = approvalDecisions ?? pairs.map(() => true);
        if (decisions.length !== pairs.length) {
          throw new Error(
            `approval decision length ${decisions.length} does not match approval pair count ${pairs.length}`,
          );
        }
        recordApprovalDecisions?.(clone(decisions));
        return decisions;
      },
    },
    getLogger: () => logger,
  };
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

function adapterContextFromBuildInput(
  input: BuildInput,
): PublicBuilderAdapterContext {
  return {
    network: input.network,
    augustusV6Address: lowerAddress(input.augustusV6Address),
    wrappedNativeTokenAddress: lowerAddress(input.wrappedNativeTokenAddress),
  };
}

function adapterContextForNetwork(
  network: number,
): PublicBuilderAdapterContext {
  switch (network) {
    case Network.BASE:
      return {
        network,
        augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
        wrappedNativeTokenAddress: lowerAddress(
          Tokens[Network.BASE].WETH.address,
        ),
      };
    case Network.BSC:
      return {
        network,
        augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
        wrappedNativeTokenAddress: lowerAddress(
          Tokens[Network.BSC].WBNB.address,
        ),
      };
    default:
      throw new Error(`missing public-builder adapter context for ${network}`);
  }
}

function lowerAddress(address: string): Address {
  return address.toLowerCase() as Address;
}

function normalizeAddress(address: string): string {
  return lowerAddress(address);
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
