import { Interface } from '@ethersproject/abi';
import { SwapSide } from '@paraswap/core';
import BalancerVaultABI from '../../../src/abi/balancer-v2/vault.json';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../../src/constants';
import { BalancerV1 } from '../../../src/dex/balancer-v1/balancer-v1';
import { BalancerV2 } from '../../../src/dex/balancer-v2/balancer-v2';
import { BalancerPoolTypes } from '../../../src/dex/balancer-v2/types';
import { CurveV1 } from '../../../src/dex/curve-v1/curve-v1';
import { CurveV2 } from '../../../src/dex/curve-v2/curve-v2';
import { CurveV2SwapType } from '../../../src/dex/curve-v2/types';
import { GenericRFQ } from '../../../src/dex/generic-rfq/generic-rfq';
import type { IDexTxBuilder, NeedWrapNativeFunc } from '../../../src/dex/idex';
import { LitePsm } from '../../../src/dex/lite-psm/lite-psm';
import { UniswapV2 } from '../../../src/dex/uniswap-v2/uniswap-v2';
import { UniswapV3 } from '../../../src/dex/uniswap-v3/uniswap-v3';
import { Weth } from '../../../src/dex/weth/weth';
import { buildGenericDexCallParams } from '../../../src/generic-swap-transaction-builder/orchestration';
import {
  buildFeesV6,
  routePositionKey,
  walkRoutePlan,
  type BuildInput,
  type DirectBuildInput,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type {
  DexExchangeParam,
  DexEncoderJsonValue,
  DexParamInput,
  DirectParamInput,
  NeedWrapNativeInput,
} from '../../../src/generic-swap-transaction-builder/dex-encoder';
import type { DirectContractMethodV6 } from '../../../src/generic-swap-transaction-builder/dex-encoder/direct-methods';
import type {
  Address,
  DexExchangeParam as LegacyDexExchangeParam,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
} from '../../../src/types';
import { loadResolvedBuildFixtures } from '../fixtures/resolved-build-loader';
import type {
  ResolvedBuildFixture,
  ResolvedBuildSuccessFixture,
} from '../fixtures/resolved-build-schema';
import {
  DEX_ENCODER_FIXTURE_SCHEMA_VERSION,
  type DexEncoderFixture,
  type DexParamFixture,
  type DirectParamFixture,
  type NeedWrapNativeFixture,
} from './dex-encoder-fixture-schema';

const DEFAULT_UUID = '11111111-1111-1111-1111-111111111111';
const WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const AUGUSTUS_V6_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';
const POOL_ADDRESS = '0x4444444444444444444444444444444444444444';
const BALANCER_POOL_ID = `0x${'44'.repeat(32)}`;
const FIXED_DIRECT_ENCODER_TIME_MS = 1_700_000_000_000;

export function buildAllDexEncoderFixtures(): DexEncoderFixture[] {
  const resolvedFixtures = loadResolvedBuildFixtures()
    .map(({ fixture }) => fixture)
    .filter(isResolvedSuccessFixture);
  const fixtures = resolvedFixtures.flatMap(fixture =>
    fixture.kind === 'generic'
      ? buildGenericDexEncoderFixtures(fixture)
      : [buildDirectDexEncoderFixture(fixture)],
  );

  return fixtures.sort((a, b) =>
    `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`),
  );
}

export function getResolvedFixtureDexCoverage(): {
  genericDexKeys: string[];
  directDexKeys: string[];
} {
  const resolvedFixtures = loadResolvedBuildFixtures()
    .map(({ fixture }) => fixture)
    .filter(isResolvedSuccessFixture);
  const genericDexKeys = new Set<string>();
  const directDexKeys = new Set<string>();

  resolvedFixtures.forEach(fixture => {
    if (fixture.kind === 'generic') {
      const priceRoute = getGenericPriceRoute(fixture);

      priceRoute.bestRoute.forEach(route => {
        route.swaps.forEach(swap => {
          swap.swapExchanges.forEach(swapExchange => {
            genericDexKeys.add(swapExchange.exchange);
          });
        });
      });
    } else {
      directDexKeys.add(getDirectDexKey(fixture));
    }
  });

  return {
    genericDexKeys: [...genericDexKeys].sort(),
    directDexKeys: [...directDexKeys].sort(),
  };
}

function buildGenericDexEncoderFixtures(
  fixture: ResolvedBuildSuccessFixture,
): DexEncoderFixture[] {
  const input = fixture.input as BuildInput;
  const priceRoute = getGenericPriceRoute(fixture);
  const resolvedLegByKey = new Map(
    input.resolvedLegs.map(resolvedLeg => [
      routePositionKey(resolvedLeg),
      resolvedLeg,
    ]),
  );

  return walkRoutePlan(input.routePlan).flatMap(routePosition => {
    const { routeIndex, swapIndex, swapExchangeIndex } = routePosition;
    const route = priceRoute.bestRoute[routeIndex];
    const swap = route.swaps[swapIndex];
    const swapExchange = swap.swapExchanges[swapExchangeIndex];
    const key = routePositionKey(routePosition);
    const resolvedLeg = resolvedLegByKey.get(key);

    if (!resolvedLeg) {
      throw new Error(`${fixture.name}: missing resolved leg for ${key}`);
    }

    const name = `${fixture.name}-${formatRoutePosition(
      routeIndex,
      swapIndex,
      swapExchangeIndex,
    )}-${slug(swapExchange.exchange)}`;
    const needWrapNativeInput = buildNeedWrapNativeInput({
      priceRoute,
      routeIndex,
      swap,
      swapIndex,
      swapExchange,
      swapExchangeIndex,
    });
    const dex = getCurrentTsDexBuilder(swapExchange.exchange);
    const dexNeedWrapNative = resolveNeedWrapNative(
      dex.needWrapNative,
      priceRoute,
      swap,
      swapExchange,
      swapExchange.exchange,
    );
    const dexCallParams = buildGenericDexCallParams({
      priceRoute,
      routeIndex,
      swap,
      swapIndex,
      swapExchange,
      minMaxAmount: input.minMaxAmount,
      dexNeedWrapNative,
      executionContractAddress: input.executorAddress,
      wrappedNativeTokenAddress: input.wrappedNativeTokenAddress,
      augustusV6Address: input.augustusV6Address,
    });
    const dexParamInput: DexParamInput = {
      ...needWrapNativeInput,
      dexKey: swapExchange.exchange,
      srcToken: normalizeAddress(dexCallParams.srcToken),
      destToken: normalizeAddress(dexCallParams.destToken),
      srcAmount:
        input.side === SwapSide.BUY
          ? swapExchange.srcAmount
          : dexCallParams.srcAmount,
      destAmount: dexCallParams.destAmount,
      recipient: normalizeAddress(dexCallParams.recipient),
      executorAddress: input.executorAddress,
      side: input.side,
      data: normalizeJsonData(swapExchange.data),
    };
    const dexParam = invokeCurrentTsGetDexParam(
      dex,
      dexParamInput,
      priceRoute,
      swap,
      swapExchange,
    );
    const needWrapFixture: NeedWrapNativeFixture = {
      schemaVersion: DEX_ENCODER_FIXTURE_SCHEMA_VERSION,
      name,
      kind: 'need-wrap-native',
      description: `${fixture.name} route ${key} needWrapNative baseline.`,
      network: input.network,
      dexKey: swapExchange.exchange,
      input: needWrapNativeInput,
      expected: dexNeedWrapNative,
    };
    const dexParamFixture: DexParamFixture = {
      schemaVersion: DEX_ENCODER_FIXTURE_SCHEMA_VERSION,
      name,
      kind: 'dex-param',
      description: `${fixture.name} route ${key} getDexParam baseline.`,
      network: input.network,
      dexKey: swapExchange.exchange,
      input: dexParamInput,
      expected: normalizeDexExchangeParam(dexParam),
    };

    return [needWrapFixture, dexParamFixture];
  });
}

function invokeCurrentTsGetDexParam(
  dex: IDexTxBuilder<unknown, unknown>,
  input: DexParamInput,
  priceRoute: OptimalRate,
  swap: OptimalSwap,
  swapExchange: OptimalSwapExchange<unknown>,
): LegacyDexExchangeParam {
  if (!dex.getDexParam) {
    throw new Error(`unsupported generic DEX fixture ${input.dexKey}`);
  }

  const result = withFixedDate(() =>
    dex.getDexParam!(
      input.srcToken,
      input.destToken,
      input.srcAmount,
      input.destAmount,
      input.recipient,
      clone(input.data),
      input.side,
      input.executorAddress,
    ),
  );

  if (
    typeof (result as PromiseLike<LegacyDexExchangeParam>).then === 'function'
  ) {
    throw new Error(
      `${input.dexKey}: async getDexParam fixtures are unsupported`,
    );
  }
  const dexParam = result as LegacyDexExchangeParam;

  return {
    ...dexParam,
    needWrapNative: resolveNeedWrapNative(
      dexParam.needWrapNative,
      priceRoute,
      swap,
      swapExchange,
      input.dexKey,
    ),
  };
}

function resolveNeedWrapNative(
  needWrapNative: LegacyDexExchangeParam['needWrapNative'],
  priceRoute: OptimalRate,
  swap: OptimalSwap,
  swapExchange: OptimalSwapExchange<unknown>,
  dexKey: string,
): boolean {
  const resolved =
    typeof needWrapNative === 'function'
      ? (needWrapNative as NeedWrapNativeFunc)(priceRoute, swap, swapExchange)
      : needWrapNative;

  if (typeof resolved !== 'boolean') {
    throw new Error(`${dexKey}: needWrapNative must resolve to boolean`);
  }

  return resolved;
}

function buildDirectDexEncoderFixture(
  fixture: ResolvedBuildSuccessFixture,
): DirectParamFixture {
  const input = fixture.input as DirectBuildInput;
  const priceRoute = getDirectPriceRoute(fixture);
  const dexKey = getDirectDexKey(fixture);
  const swapExchange = priceRoute.bestRoute[0].swaps[0].swapExchanges[0];
  const data = buildDirectParamData(fixture, input, dexKey);
  const directInput: DirectParamInput = {
    dexKey,
    network: priceRoute.network,
    contractMethod: input.contractMethod as DirectContractMethodV6,
    srcToken: normalizeAddress(priceRoute.srcToken),
    destToken: normalizeAddress(
      fixture.orchestration?.directDestToken ?? priceRoute.destToken,
    ),
    srcAmount:
      input.side === SwapSide.SELL
        ? swapExchange.srcAmount
        : input.minMaxAmount,
    destAmount:
      input.side === SwapSide.SELL
        ? input.minMaxAmount
        : swapExchange.destAmount,
    quotedAmount:
      fixture.orchestration?.quotedAmount ??
      (input.side === SwapSide.SELL
        ? priceRoute.destAmount
        : priceRoute.srcAmount),
    data,
    side: input.side,
    permit: '0x',
    uuid: DEFAULT_UUID,
    partnerAndFee: buildFeesV6({
      referrerAddress: undefined,
      partnerAddress: NULL_ADDRESS,
      partnerFeePercent: '0',
      takeSurplus: false,
      isCapSurplus: false,
      isSurplusToUser: false,
      isDirectFeeTransfer: false,
    }),
    beneficiary: NULL_ADDRESS,
    blockNumber: priceRoute.blockNumber,
  };
  const directParamResult = invokeCurrentTsGetDirectParamV6(directInput);

  return {
    schemaVersion: DEX_ENCODER_FIXTURE_SCHEMA_VERSION,
    name: fixture.name,
    kind: 'direct-param',
    description: `${fixture.name} getDirectParamV6 baseline.`,
    network: priceRoute.network,
    dexKey,
    contractMethod: directInput.contractMethod,
    input: directInput,
    expected: {
      params: directParamResult.params,
    },
  };
}

function buildDirectParamData(
  fixture: ResolvedBuildSuccessFixture,
  input: DirectBuildInput,
  dexKey: string,
): DexEncoderJsonValue {
  const srcToken = normalizeAddress(input.srcToken);
  const destToken = normalizeAddress(
    fixture.orchestration?.directDestToken ??
      getDirectPriceRoute(fixture).destToken,
  );

  if (dexKey === 'UniswapV2') {
    return {
      router: POOL_ADDRESS,
      path: [srcToken, destToken],
      pools: [{ address: POOL_ADDRESS, direction: true, fee: 30 }],
      factory: POOL_ADDRESS,
      initCode: '0x1234',
      feeFactor: 10000,
      wethAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
    };
  }

  if (dexKey === 'UniswapV3') {
    return {
      path: [
        {
          tokenIn: srcToken,
          tokenOut: destToken,
          fee: '500',
          currentFee: '500',
        },
      ],
      isApproved: true,
    };
  }

  if (dexKey === 'BalancerV2') {
    return {
      swaps: [
        {
          poolId: BALANCER_POOL_ID,
          amount:
            input.side === SwapSide.SELL ? input.srcAmount : input.minMaxAmount,
        },
      ],
      isApproved: true,
    };
  }

  if (dexKey === 'CurveV1') {
    return {
      exchange: POOL_ADDRESS,
      i: 0,
      j: 1,
      underlyingSwap: false,
      deadline: 0,
      isApproved: true,
    };
  }

  if (dexKey === 'CurveV2') {
    return {
      i: 0,
      j: 1,
      exchange: POOL_ADDRESS,
      originalPoolAddress: POOL_ADDRESS,
      swapType: CurveV2SwapType.EXCHANGE,
      isApproved: true,
    };
  }

  if (dexKey === 'LitePsm') {
    return {
      psmAddress: POOL_ADDRESS,
      gemDecimals: 6,
      toll: '0',
      isApproved: true,
    };
  }

  if (dexKey === 'GenericRFQ') {
    return {
      orderInfos: clone((input.params as unknown[])[1]) as DexEncoderJsonValue,
      isApproved: true,
    };
  }

  throw new Error(`${fixture.name}: unsupported direct DEX fixture ${dexKey}`);
}

function invokeCurrentTsGetDirectParamV6(input: DirectParamInput): {
  params: DexEncoderJsonValue[];
} {
  const args = [
    input.srcToken,
    input.destToken,
    input.srcAmount,
    input.destAmount,
    input.quotedAmount,
    clone(input.data),
    input.side,
    input.permit,
    input.uuid,
    input.partnerAndFee,
    input.beneficiary,
    input.blockNumber,
    input.contractMethod,
  ] as const;
  const dexHelper = buildDirectDexHelper();
  const contextByDexKey: Record<string, any> = {
    UniswapV2: {
      dexKey: input.dexKey,
      dexHelper,
      logger: createNoopLogger(),
      _encodePathV6: (UniswapV2.prototype as any)._encodePathV6,
    },
    UniswapV3: {
      dexKey: input.dexKey,
      dexHelper,
      logger: createNoopLogger(),
      _encodePathV6: (UniswapV3.prototype as any)._encodePathV6,
      _encodePool: (UniswapV3.prototype as any)._encodePool,
    },
    BalancerV2: buildBalancerV2DirectContext(input, dexHelper),
    CurveV1: {},
    CurveV2: {},
    LitePsm: {},
    GenericRFQ: {
      dexKey: input.dexKey,
    },
  };
  const prototypeByDexKey: Record<string, any> = {
    UniswapV2: UniswapV2.prototype,
    UniswapV3: UniswapV3.prototype,
    BalancerV2: BalancerV2.prototype,
    CurveV1: CurveV1.prototype,
    CurveV2: CurveV2.prototype,
    LitePsm: LitePsm.prototype,
    GenericRFQ: GenericRFQ.prototype,
  };
  const prototype = prototypeByDexKey[input.dexKey];
  const context = contextByDexKey[input.dexKey];

  if (!prototype || !context) {
    throw new Error(`unsupported direct DEX fixture ${input.dexKey}`);
  }

  const result = withFixedDate(() =>
    prototype.getDirectParamV6.call(context, ...args),
  );

  return {
    params: clone(result.params) as DexEncoderJsonValue[],
  };
}

function withFixedDate<T>(callback: () => T): T {
  const RealDate = Date;

  class FixedDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? FIXED_DIRECT_ENCODER_TIME_MS);
    }

    static now(): number {
      return FIXED_DIRECT_ENCODER_TIME_MS;
    }
  }

  global.Date = FixedDate as DateConstructor;

  try {
    return callback();
  } finally {
    global.Date = RealDate;
  }
}

function buildBalancerV2DirectContext(
  input: DirectParamInput,
  dexHelper: ReturnType<typeof buildDirectDexHelper>,
): Record<string, unknown> {
  const pool = buildBalancerPool(input.srcToken, input.destToken);

  return {
    dexHelper,
    logger: createNoopLogger(),
    poolIdMap: { [BALANCER_POOL_ID]: pool },
    poolAddressMap: { [POOL_ADDRESS]: pool },
    balancerVaultInterface: new Interface(BalancerVaultABI),
    getBalancerV2BatchSwapParam:
      BalancerV2.prototype.getBalancerV2BatchSwapParam,
    getBalancerV2SwapParam: BalancerV2.prototype.getBalancerV2SwapParam,
    encodeBeneficiaryAndApproveFlag: (BalancerV2.prototype as any)
      .encodeBeneficiaryAndApproveFlag,
    encodeBalancerV2SwapParam: (BalancerV2.prototype as any)
      .encodeBalancerV2SwapParam,
    encodeBalancerV2BatchSwapParam: (BalancerV2.prototype as any)
      .encodeBalancerV2BatchSwapParam,
  };
}

function buildBalancerPool(srcToken: Address, destToken: Address) {
  const src = normalizeAddress(srcToken);
  const dest = normalizeAddress(destToken);

  return {
    id: BALANCER_POOL_ID,
    address: POOL_ADDRESS,
    poolType: BalancerPoolTypes.Weighted,
    poolTypeVersion: 1,
    tokens: [
      { address: src, decimals: 18 },
      { address: dest, decimals: 18 },
    ],
    tokensMap: {
      [src]: { address: src, decimals: 18 },
      [dest]: { address: dest, decimals: 18 },
    },
    mainIndex: 0,
    wrappedIndex: 1,
    mainTokens: [
      {
        address: src,
        decimals: 18,
        poolToken: { address: src, decimals: 18 },
        pathToToken: [],
        isDeeplyNested: false,
      },
      {
        address: dest,
        decimals: 18,
        poolToken: { address: dest, decimals: 18 },
        pathToToken: [],
        isDeeplyNested: false,
      },
    ],
    root3Alpha: '',
    alpha: '',
    beta: '',
    c: '',
    s: '',
    lambda: '',
    tauAlphaX: '',
    tauAlphaY: '',
    tauBetaX: '',
    tauBetaY: '',
    u: '',
    v: '',
    w: '',
    z: '',
    dSq: '',
  };
}

let currentTsDexBuilders:
  | Record<string, IDexTxBuilder<unknown, unknown>>
  | undefined;

function getCurrentTsDexBuilder(
  dexKey: string,
): IDexTxBuilder<unknown, unknown> {
  if (!currentTsDexBuilders) {
    const dexHelper = buildDirectDexHelper();

    currentTsDexBuilders = {
      BalancerV1: new BalancerV1(Network.MAINNET, 'BalancerV1', dexHelper),
      SushiSwapV3: new UniswapV3(Network.MAINNET, 'SushiSwapV3', dexHelper),
      UniswapV3: new UniswapV3(Network.MAINNET, 'UniswapV3', dexHelper),
      Weth: new Weth(Network.MAINNET, 'Weth', dexHelper),
    };
  }

  const dex = currentTsDexBuilders[dexKey];
  if (!dex) throw new Error(`unsupported generic DEX fixture ${dexKey}`);

  return dex;
}

function buildDirectDexHelper(): any {
  class DummyContract {}

  return {
    config: {
      isSlave: true,
      data: {
        network: Network.MAINNET,
        augustusAddress: AUGUSTUS_V6_ADDRESS,
        augustusV6Address: AUGUSTUS_V6_ADDRESS,
        augustusRFQAddress: NULL_ADDRESS,
        wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        uniswapV2ExchangeRouterAddress: POOL_ADDRESS,
        tokenTransferProxyAddress: NULL_ADDRESS,
        multicallV2Address: NULL_ADDRESS,
        adapterAddresses: {},
        executorsAddresses: {},
        rfqConfigs: {},
        apiKeyTheGraph: '',
      },
      wrapETH: <T extends { address: Address }>(token: T): T => ({
        ...token,
        address:
          token.address.toLowerCase() === ETHER_ADDRESS
            ? WRAPPED_NATIVE_TOKEN_ADDRESS
            : normalizeAddress(token.address),
      }),
      isWETH: (address: Address): boolean =>
        address.toLowerCase() === WRAPPED_NATIVE_TOKEN_ADDRESS,
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
    getLogger: createNoopLogger,
  };
}

function createNoopLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function buildNeedWrapNativeInput({
  priceRoute,
  routeIndex,
  swap,
  swapIndex,
  swapExchange,
  swapExchangeIndex,
}: {
  priceRoute: OptimalRate;
  routeIndex: number;
  swap: OptimalSwap;
  swapIndex: number;
  swapExchange: OptimalSwapExchange<unknown>;
  swapExchangeIndex: number;
}): NeedWrapNativeInput {
  const route = priceRoute.bestRoute[routeIndex];

  return {
    route: {
      network: priceRoute.network,
      side: priceRoute.side,
      routeIndex,
      routePercent: route.percent,
      blockNumber: priceRoute.blockNumber,
      srcToken: normalizeAddress(priceRoute.srcToken),
      destToken: normalizeAddress(priceRoute.destToken),
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
    },
    swap: {
      swapIndex,
      srcToken: normalizeAddress(swap.srcToken),
      destToken: normalizeAddress(swap.destToken),
      srcAmount: sumSwapExchangeAmounts(swap.swapExchanges, 'srcAmount'),
      destAmount: sumSwapExchangeAmounts(swap.swapExchanges, 'destAmount'),
    },
    swapExchange: {
      swapExchangeIndex,
      exchange: swapExchange.exchange,
      srcAmount: swapExchange.srcAmount,
      destAmount: swapExchange.destAmount,
      percent: swapExchange.percent,
      data: normalizeJsonData(swapExchange.data),
    },
  };
}

function normalizeDexExchangeParam(
  exchangeParam: LegacyDexExchangeParam,
): DexExchangeParam {
  const normalized = clone(exchangeParam) as DexExchangeParam &
    Record<string, unknown> & {
      approveData?: unknown;
    };

  delete normalized.approveData;
  delete normalized.dexFuncHasDestToken;
  normalized.targetExchange = normalizeAddress(normalized.targetExchange);

  if (normalized.wethAddress !== undefined) {
    normalized.wethAddress = normalizeAddress(normalized.wethAddress);
  }

  if (normalized.transferSrcTokenBeforeSwap !== undefined) {
    normalized.transferSrcTokenBeforeSwap = normalizeAddress(
      normalized.transferSrcTokenBeforeSwap,
    );
  }

  if (normalized.spender !== undefined) {
    normalized.spender = normalizeAddress(normalized.spender);
  }

  return normalized;
}

function getGenericPriceRoute(
  fixture: ResolvedBuildSuccessFixture,
): OptimalRate {
  const priceRoute = fixture.orchestration?.priceRoute;

  if (!priceRoute || fixture.kind !== 'generic') {
    throw new Error(`${fixture.name}: missing generic priceRoute`);
  }

  return priceRoute;
}

function getDirectPriceRoute(
  fixture: ResolvedBuildSuccessFixture,
): OptimalRate {
  const priceRoute = fixture.orchestration?.priceRoute;

  if (!priceRoute || fixture.kind !== 'direct') {
    throw new Error(`${fixture.name}: missing direct priceRoute`);
  }

  return priceRoute;
}

function getDirectDexKey(fixture: ResolvedBuildSuccessFixture): string {
  const dexKey = fixture.orchestration?.directDexKey;

  if (!dexKey || fixture.kind !== 'direct') {
    throw new Error(`${fixture.name}: missing direct dex key`);
  }

  return dexKey;
}

function isResolvedSuccessFixture(
  fixture: ResolvedBuildFixture,
): fixture is ResolvedBuildSuccessFixture {
  const boundaryOnly = (fixture as { boundaryOnly?: unknown }).boundaryOnly;

  return fixture.kind !== 'negative' && boundaryOnly !== true;
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase();
}

function normalizeJsonData(value: unknown): DexEncoderJsonValue {
  return (value === undefined ? null : clone(value)) as DexEncoderJsonValue;
}

function sumSwapExchangeAmounts(
  swapExchanges: OptimalSwapExchange<unknown>[],
  field: 'srcAmount' | 'destAmount',
): string {
  return swapExchanges
    .reduce((sum, swapExchange) => sum + BigInt(swapExchange[field]), 0n)
    .toString();
}

function formatRoutePosition(
  routeIndex: number,
  swapIndex: number,
  swapExchangeIndex: number,
): string {
  return `r${routeIndex}-s${swapIndex}-e${swapExchangeIndex}`;
}

function slug(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
