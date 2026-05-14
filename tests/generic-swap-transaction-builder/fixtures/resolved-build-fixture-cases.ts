import {
  ContractMethodV6,
  OptimalRate,
  ParaSwapVersion,
  SwapSide,
} from '@paraswap/core';
import fs from 'fs';
import path from 'path';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../../src/constants';
import type { DexAdapterService } from '../../../src/dex';
import type { DepositWithdrawReturn } from '../../../src/dex/weth/types';
import { getApprovalTokenAndTarget } from '../../../src/executor/approval';
import { createExecutorEncodingContextFromDexHelper } from '../../../src/executor/encoding-context';
import type { ExecutorEncodingContext } from '../../../src/executor/encoding-types';
import { Executors } from '../../../src/executor/types';
import { GenericSwapTransactionBuilder } from '../../../src/generic-swap-transaction-builder';
import {
  buildDirectTransactionFromResolved,
  buildRoutePlan,
  buildTransactionFromResolved,
  routePositionKey,
  walkRoutePlan,
  type BuildInput,
  type DirectBuildInput,
  type ResolvedBuildOutput,
  type ResolvedLeg,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type {
  Address,
  DexExchangeBuildParam,
  OptimalSwap,
  OptimalSwapExchange,
  TxInfo,
  TxObject,
} from '../../../src/types';
import {
  AUGUSTUS_V6_INTERFACE,
  createDirectResolvedBuildDeps,
  createResolvedBuildDeps,
} from './resolved-build-deps';
import {
  RESOLVED_BUILD_SCHEMA_VERSION,
  type CoverageTag,
  type ResolvedBuildFixture,
  type ResolvedBuildSuccessFixture,
} from './resolved-build-schema';

export const USER_ADDRESS = '0x1111111111111111111111111111111111111111';
export const AUGUSTUS_V6_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';
export const WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
export const EXECUTOR_01_ADDRESS = '0x000010036c0190e009a000d0fc3541100a07380a';
export const EXECUTOR_02_ADDRESS = '0x00c600b30fb0400701010f4b080409018b9006e0';
export const EXECUTOR_03_ADDRESS = '0xa000b020c290d000020aac04026b5306d60050f0';
export const UUID = '11111111-1111-1111-1111-111111111111';
export const MIN_MAX_AMOUNT = '990000';
export const WETH_DEX_KEY = 'Weth';
export const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const POOL_ADDRESS = '0x4444444444444444444444444444444444444444';
export const MAKER_ADDRESS = '0xdddddddddddddddddddddddddddddddddddddddd';
export const TAKER_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const PARTNER_ADDRESS = '0x2222222222222222222222222222222222222222';
export const REFERRER_ADDRESS = '0x3333333333333333333333333333333333333333';
export const BENEFICIARY_ADDRESS = '0x5555555555555555555555555555555555555555';
export const GAS = {
  gasPrice: '1',
  maxFeePerGas: '2',
  maxPriorityFeePerGas: '3',
};

const METADATA = `0x${'11'.repeat(32)}`;
const FIXTURE_ROOT = path.join(process.cwd(), 'src/executor/fixtures');

type ApprovalPair = [token: Address, target: Address, permit2: boolean];
type ApprovalDecision = (pairs: ApprovalPair[]) => boolean[];

type GenericCase = {
  name: string;
  description?: string;
  coverage: CoverageTag[];
  priceRoute: OptimalRate;
  exchangeParams: DexExchangeBuildParam[];
  maybeWethCallData?: DepositWithdrawReturn;
  minMaxAmount?: string;
  quotedAmount?: string;
  approvalDecisions?: boolean[];
  partnerAddress?: Address;
  partnerFeePercent?: string;
  referrerAddress?: Address;
  takeSurplus?: boolean;
  isCapSurplus?: boolean;
  isSurplusToUser?: boolean;
  isDirectFeeTransfer?: boolean;
  beneficiary?: Address;
  permit?: string;
  uuid?: string;
  gas?: BuildInput['gas'];
};

type DirectCase = {
  name: string;
  description?: string;
  coverage: CoverageTag[];
  dexKey: string;
  contractMethod: ContractMethodV6;
  side: SwapSide;
  params: unknown[];
  srcToken?: Address;
  destToken?: Address;
  srcAmount?: string;
  destAmount?: string;
  minMaxAmount?: string;
  quotedAmount?: string;
  gas?: DirectBuildInput['gas'];
};

type ExpectedInputResult = {
  input: BuildInput;
  approvalPairs: ApprovalPair[];
  approvalDecisions: boolean[];
};

type RouteDexFixture = {
  exchange: string;
  swap: OptimalSwap;
  swapExchange: OptimalSwapExchange<any>;
  exchangeParam: DexExchangeBuildParam;
};

export async function buildAllResolvedBuildFixtures(): Promise<
  ResolvedBuildFixture[]
> {
  const genericFixtures = await Promise.all(
    buildGenericCases().map(buildGenericSuccessFixture),
  );
  const directFixtures = await Promise.all(
    buildDirectCases().map(buildDirectSuccessFixture),
  );
  const negativeFixtures = buildNegativeFixtures(
    findSuccessFixtureByName(
      genericFixtures,
      'executor01-simple-sell-approved',
    ),
    findSuccessFixtureByName(directFixtures, 'uniswap-v2-sell'),
  );

  return [...genericFixtures, ...directFixtures, ...negativeFixtures];
}

function findSuccessFixtureByName(
  fixtures: ResolvedBuildSuccessFixture[],
  name: string,
): ResolvedBuildSuccessFixture {
  const fixture = fixtures.find(candidate => candidate.name === name);

  if (!fixture) {
    throw new Error(`missing generated fixture: ${name}`);
  }

  return fixture;
}

function buildGenericCases(): GenericCase[] {
  const executor01SimpleRoute =
    'executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
  const executor01SimpleParams =
    'executor01/exchange-params/price-route-simpleSwap-univ3-usdc-usdt.json';
  const executor01EthUsdcRoute =
    'executor01/routes/price-route-simpleSwap-univ3-eth-usdc.json';
  const executor01EthUsdcParams =
    'executor01/exchange-params/price-route-simpleSwap-univ3-eth-usdc.json';
  const executor01EthUsdcWeth =
    'executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-eth-usdc.json';
  const executor01UsdcEthRoute =
    'executor01/routes/price-route-simpleSwap-univ3-usdc-eth.json';
  const executor01UsdcEthParams =
    'executor01/exchange-params/price-route-simpleSwap-univ3-usdc-eth.json';
  const executor01UsdcEthWeth =
    'executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-usdc-eth.json';
  const executor01MultiswapRoute =
    'executor01/routes/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
  const executor01MultiswapParams =
    'executor01/exchange-params/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
  const executor01MultiswapWeth =
    'executor01/maybe-weth-calldata/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
  const executor02VerticalRoute =
    'executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
  const executor02VerticalParams =
    'executor02/exchange-params/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
  const executor02VerticalWeth =
    'executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
  const executor02MultiswapRoute =
    'executor02/routes/price-route-multiswap-univ3-usdt-dai-eth.json';
  const executor02MultiswapParams =
    'executor02/exchange-params/price-route-multiswap-univ3-usdt-dai-eth.json';
  const executor02MultiswapWeth =
    'executor02/maybe-weth-calldata/price-route-multiswap-univ3-usdt-dai-eth.json';

  const permit2Params = buildExchangeParams(executor01SimpleParams);
  permit2Params[0].permit2Approval = true;

  const transferParams = buildExchangeParams(executor01SimpleParams);
  transferParams[0].transferSrcTokenBeforeSwap = POOL_ADDRESS;

  const needUnwrapRoute = buildPriceRouteFromFixture(executor01SimpleRoute, {
    srcToken: WRAPPED_NATIVE_TOKEN_ADDRESS,
  });
  needUnwrapRoute.bestRoute[0].swaps[0].srcToken = WRAPPED_NATIVE_TOKEN_ADDRESS;
  needUnwrapRoute.bestRoute[0].swaps[0].swapExchanges[0].srcAmount =
    needUnwrapRoute.srcAmount;
  const needUnwrapParams = buildExchangeParams(executor01SimpleParams);
  needUnwrapParams[0].needUnwrapNative = true;
  needUnwrapParams[0].wethAddress = WRAPPED_NATIVE_TOKEN_ADDRESS;

  const sameTokenRoute = buildPriceRouteFromFixture(executor01SimpleRoute);
  sameTokenRoute.destToken = sameTokenRoute.srcToken;
  sameTokenRoute.destAmount = sameTokenRoute.srcAmount;
  sameTokenRoute.bestRoute[0].swaps[0].destToken = sameTokenRoute.srcToken;
  sameTokenRoute.bestRoute[0].swaps[0].swapExchanges = [
    {
      ...clone(sameTokenRoute.bestRoute[0].swaps[0].swapExchanges[0]),
      srcAmount: '500000',
      destAmount: '500000',
      percent: 50,
    },
    {
      ...clone(sameTokenRoute.bestRoute[0].swaps[0].swapExchanges[0]),
      srcAmount: '500000',
      destAmount: '500000',
      percent: 50,
    },
  ];
  const sameTokenExchangeParams = buildExchangeParams(executor01SimpleParams);
  sameTokenExchangeParams.push(clone(sameTokenExchangeParams[0]));

  return [
    {
      name: 'executor01-simple-sell-approved',
      description: 'Executor01 simple SELL route with approvals present.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'approval-present',
        'null-beneficiary',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
    },
    {
      name: 'executor01-simple-sell-beneficiary',
      description:
        'Executor01 simple SELL route with non-null beneficiary passthrough.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'beneficiary-nonnull',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      beneficiary: BENEFICIARY_ADDRESS,
    },
    {
      name: 'executor01-simple-sell-approval-missing',
      description: 'Executor01 simple SELL route with approval calldata.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'approval-missing',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      approvalDecisions: [false],
    },
    {
      name: 'executor01-eth-weth-deposit',
      description: 'Executor01 ETH source route with precomputed WETH deposit.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'weth-deposit',
        'native-source',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01EthUsdcRoute),
      exchangeParams: buildExchangeParams(executor01EthUsdcParams),
      maybeWethCallData: buildWethPlan(executor01EthUsdcWeth),
    },
    {
      name: 'executor01-weth-eth-withdraw',
      description:
        'Executor01 ETH destination route with precomputed WETH withdraw.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'weth-withdraw',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01UsdcEthRoute),
      exchangeParams: buildExchangeParams(executor01UsdcEthParams),
      maybeWethCallData: buildWethPlan(executor01UsdcEthWeth),
    },
    {
      name: 'executor01-multiswap-sell',
      description: 'Executor01 horizontal multiswap SELL route.',
      coverage: ['generic', 'executor01', 'multi-swap', 'sell'],
      priceRoute: buildPriceRouteFromFixture(executor01MultiswapRoute),
      exchangeParams: buildExchangeParams(executor01MultiswapParams),
      maybeWethCallData: buildWethPlan(executor01MultiswapWeth),
    },
    {
      name: 'executor02-vertical-branch-sell',
      description: 'Executor02 vertical branch SELL route.',
      coverage: [
        'generic',
        'executor02',
        'vertical-branch',
        'sell',
        'weth-deposit',
      ],
      priceRoute: buildPriceRouteFromFixture(executor02VerticalRoute),
      exchangeParams: buildExchangeParams(executor02VerticalParams),
      maybeWethCallData: buildWethPlan(executor02VerticalWeth),
    },
    {
      name: 'executor02-multiswap-sell',
      description: 'Executor02 multiswap SELL route with vertical branches.',
      coverage: [
        'generic',
        'executor02',
        'multi-swap',
        'vertical-branch',
        'sell',
        'weth-withdraw',
      ],
      priceRoute: buildPriceRouteFromFixture(executor02MultiswapRoute),
      exchangeParams: buildExchangeParams(executor02MultiswapParams),
      maybeWethCallData: buildWethPlan(executor02MultiswapWeth),
    },
    buildExecutor02MegaSwapCase(
      executor02VerticalRoute,
      executor02VerticalParams,
      executor02VerticalWeth,
      executor01EthUsdcRoute,
      executor01EthUsdcParams,
      executor01EthUsdcWeth,
    ),
    {
      name: 'executor03-buy',
      description: 'Executor03 BUY route using the generic boundary.',
      coverage: ['generic', 'executor03', 'simple-swap', 'buy'],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute, {
        side: SwapSide.BUY,
        contractMethod: ContractMethodV6.swapExactAmountOut,
      }),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
    },
    {
      name: 'weth-only-eth-to-weth',
      description: 'WETH-only ETH to WETH route.',
      coverage: [
        'generic',
        'executor-weth',
        'weth-only',
        'sell',
        'native-source',
      ],
      priceRoute: buildWethOnlyPriceRoute(),
      exchangeParams: [buildWethOnlyExchangeParam()],
    },
    {
      name: 'same-token-internal-split',
      description:
        'Route-plan fixture where the public pair is internally same-token.',
      coverage: [
        'generic',
        'executor02',
        'simple-swap',
        'vertical-branch',
        'sell',
        'same-token-internal-split',
      ],
      priceRoute: sameTokenRoute,
      exchangeParams: sameTokenExchangeParams,
    },
    {
      name: 'permit2-approval',
      description:
        'Approval-missing route that uses Permit2 approval calldata.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'approval-missing',
        'permit2-approval',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: permit2Params,
      approvalDecisions: [false],
    },
    {
      name: 'transfer-src-token-before-swap',
      description:
        'Route with transferSrcTokenBeforeSwap in the resolved DEX params.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'transfer-src-token-before-swap',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: transferParams,
    },
    {
      name: 'need-unwrap-native',
      description:
        'Route with needUnwrapNative set on the resolved DEX params.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'need-unwrap-native',
      ],
      priceRoute: needUnwrapRoute,
      exchangeParams: needUnwrapParams,
    },
    {
      name: 'fee-nonzero-partner',
      description: 'Non-zero partner fee packing.',
      coverage: ['generic', 'executor01', 'simple-swap', 'sell', 'fee-nonzero'],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      partnerAddress: PARTNER_ADDRESS,
      partnerFeePercent: '25',
    },
    {
      name: 'fee-referrer',
      description: 'Referrer fee packing path.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'fee-referrer',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      referrerAddress: REFERRER_ADDRESS,
    },
    {
      name: 'fee-take-surplus',
      description: 'takeSurplus partner-and-fee packing path.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'fee-take-surplus',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      partnerAddress: PARTNER_ADDRESS,
      takeSurplus: true,
    },
    {
      name: 'fee-surplus-to-user',
      description: 'isSurplusToUser partner-and-fee packing path.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'fee-surplus-to-user',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      isSurplusToUser: true,
    },
    {
      name: 'fee-direct-transfer',
      description: 'isDirectFeeTransfer partner-and-fee packing path.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'fee-direct-transfer',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      partnerAddress: PARTNER_ADDRESS,
      partnerFeePercent: '10',
      isDirectFeeTransfer: true,
    },
    {
      name: 'edge-nonempty-permit',
      description: 'Generic boundary fixture with non-empty permit bytes.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'permit-nonempty',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      permit: '0x1234',
    },
    {
      name: 'edge-zero-quoted-amount',
      description: 'Generic boundary fixture with quotedAmount set to zero.',
      coverage: [
        'generic',
        'executor01',
        'simple-swap',
        'sell',
        'zero-quoted-amount',
      ],
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRoute),
      exchangeParams: buildExchangeParams(executor01SimpleParams),
      quotedAmount: '0',
    },
  ];
}

function buildDirectCases(): DirectCase[] {
  return [
    {
      name: 'uniswap-v2-sell',
      description: 'Direct UniswapV2 SELL method.',
      coverage: ['direct', 'sell', 'native-source'],
      dexKey: 'UniswapV2',
      contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV2,
      side: SwapSide.SELL,
      srcToken: ETHER_ADDRESS,
      destToken: TOKEN_A,
      srcAmount: '1000',
      destAmount: '995',
      minMaxAmount: '990',
      params: buildUniParams(ETHER_ADDRESS, TOKEN_A, '1000', '990', '995'),
    },
    {
      name: 'uniswap-v2-buy',
      description: 'Direct UniswapV2 BUY method.',
      coverage: ['direct', 'buy'],
      dexKey: 'UniswapV2',
      contractMethod: ContractMethodV6.swapExactAmountOutOnUniswapV2,
      side: SwapSide.BUY,
      srcAmount: '1300',
      destAmount: '1000',
      minMaxAmount: '1200',
      quotedAmount: '1100',
      params: buildUniParams(TOKEN_A, TOKEN_B, '1200', '1000', '1100'),
    },
    {
      name: 'uniswap-v3-sell',
      description: 'Direct UniswapV3 SELL method.',
      coverage: ['direct', 'sell'],
      dexKey: 'UniswapV3',
      contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV3,
      side: SwapSide.SELL,
      params: buildUniParams(TOKEN_A, TOKEN_B, '1000', '990', '995'),
    },
    {
      name: 'uniswap-v3-buy',
      description: 'Direct UniswapV3 BUY method.',
      coverage: ['direct', 'buy'],
      dexKey: 'UniswapV3',
      contractMethod: ContractMethodV6.swapExactAmountOutOnUniswapV3,
      side: SwapSide.BUY,
      srcAmount: '1300',
      destAmount: '1000',
      minMaxAmount: '1200',
      quotedAmount: '1100',
      params: buildUniParams(TOKEN_A, TOKEN_B, '1200', '1000', '1100'),
    },
    {
      name: 'balancer-v2-sell',
      description: 'Direct BalancerV2 SELL method.',
      coverage: ['direct', 'sell'],
      dexKey: 'BalancerV2',
      contractMethod: ContractMethodV6.swapExactAmountInOnBalancerV2,
      side: SwapSide.SELL,
      params: [['1000', '990', '995', METADATA, '0'], '0', '0x', '0x1234'],
    },
    {
      name: 'balancer-v2-buy',
      description: 'Direct BalancerV2 BUY method.',
      coverage: ['direct', 'buy'],
      dexKey: 'BalancerV2',
      contractMethod: ContractMethodV6.swapExactAmountOutOnBalancerV2,
      side: SwapSide.BUY,
      minMaxAmount: '1200',
      quotedAmount: '1100',
      params: [['1200', '1000', '1100', METADATA, '0'], '0', '0x', '0x1234'],
    },
    {
      name: 'curve-v1-sell',
      description: 'Direct CurveV1 SELL method.',
      coverage: ['direct', 'sell'],
      dexKey: 'CurveV1',
      contractMethod: ContractMethodV6.swapExactAmountInOnCurveV1,
      side: SwapSide.SELL,
      params: [
        [
          '0',
          '0',
          TOKEN_A,
          TOKEN_B,
          '1000',
          '990',
          '995',
          METADATA,
          NULL_ADDRESS,
        ],
        '0',
        '0x',
      ],
    },
    {
      name: 'curve-v2-sell',
      description: 'Direct CurveV2 SELL method.',
      coverage: ['direct', 'sell'],
      dexKey: 'CurveV2',
      contractMethod: ContractMethodV6.swapExactAmountInOnCurveV2,
      side: SwapSide.SELL,
      params: [
        [
          '0',
          '0',
          '1',
          POOL_ADDRESS,
          TOKEN_A,
          TOKEN_B,
          '1000',
          '990',
          '995',
          METADATA,
          NULL_ADDRESS,
        ],
        '0',
        '0x',
      ],
    },
    {
      name: 'lite-psm',
      description: 'Direct Maker PSM method.',
      coverage: ['direct', 'sell'],
      dexKey: 'LitePsm',
      contractMethod: ContractMethodV6.swapExactAmountInOutOnMakerPSM,
      side: SwapSide.SELL,
      params: [
        [
          TOKEN_A,
          TOKEN_B,
          '1000',
          '990',
          '0',
          '1',
          POOL_ADDRESS,
          POOL_ADDRESS,
          METADATA,
          '0',
        ],
        '0x',
      ],
    },
    {
      name: 'augustus-rfq-try-batch-fill',
      description: 'Direct Augustus RFQ try-batch-fill method.',
      coverage: ['direct', 'sell'],
      dexKey: 'GenericRFQ',
      contractMethod: ContractMethodV6.swapOnAugustusRFQTryBatchFill,
      side: SwapSide.SELL,
      params: [
        ['1000', '990', '0', METADATA, NULL_ADDRESS],
        [
          [
            [
              '1',
              '9999999999',
              TOKEN_B,
              TOKEN_A,
              MAKER_ADDRESS,
              TAKER_ADDRESS,
              '990',
              '1000',
            ],
            '0x1234',
            '1000',
            '0x',
            '0x',
          ],
        ],
        '0x',
      ],
    },
  ];
}

async function buildGenericSuccessFixture(
  genericCase: GenericCase,
): Promise<ResolvedBuildSuccessFixture> {
  const priceRoute = buildTestPriceRoute(clone(genericCase.priceRoute));
  const minMaxAmount = getMinMaxAmount(priceRoute, genericCase.minMaxAmount);
  const quotedAmount = getQuotedAmount(priceRoute, genericCase.quotedAmount);
  const gas = genericCase.gas ?? GAS;
  const explicitApprovalDecisions = genericCase.approvalDecisions;
  let capturedApprovalDecisions: boolean[] | undefined;
  const approvalDecision: ApprovalDecision = pairs => {
    let decisions: boolean[];

    if (explicitApprovalDecisions !== undefined) {
      if (explicitApprovalDecisions.length !== pairs.length) {
        throw new Error(
          `${genericCase.name}: approval decision length must match approval pair count`,
        );
      }
      decisions = explicitApprovalDecisions;
    } else {
      decisions = pairs.map(() => true);
    }

    if (capturedApprovalDecisions === undefined) {
      capturedApprovalDecisions = decisions;
    } else {
      assertEqual(
        decisions,
        capturedApprovalDecisions,
        `${genericCase.name}: approval decisions changed between public builds`,
      );
    }

    return decisions;
  };
  const dexHelper = buildDexHelper();
  const exchangeParams = clone(genericCase.exchangeParams);
  const maybeWethCallData = cloneWethPlan(genericCase.maybeWethCallData);
  const dexAdapterService = buildGenericDexAdapterService({
    priceRoute,
    dexHelper,
    exchangeParams,
    maybeWethCallData,
    approvalDecision,
  });
  const capturedBuildInputs: BuildInput[] = [];
  const builder = new GenericSwapTransactionBuilder(dexAdapterService, {
    resolvedBuildInputObserver: {
      onGenericBuildInput: input => capturedBuildInputs.push(clone(input)),
    },
  });
  const args = buildArgsFromGenericCase({
    priceRoute,
    minMaxAmount,
    quotedAmount,
    gas,
    genericCase,
  });
  const tx = (await builder.build(args)) as TxObject;
  const params = (await builder.build({
    ...args,
    onlyParams: true,
  })) as ResolvedBuildOutput['params'];
  const actualInput = getCapturedBoundaryInput(
    capturedBuildInputs,
    `${genericCase.name}: captured generic BuildInput parity failed`,
  );
  const expectedOutput = buildTransactionFromResolved(
    actualInput,
    createResolvedBuildDeps(actualInput),
  );

  assertEqual(
    tx,
    expectedOutput.txObject,
    `${genericCase.name}: public tx parity failed`,
  );
  assertEqual(
    params,
    expectedOutput.params,
    `${genericCase.name}: public onlyParams parity failed`,
  );

  return {
    schemaVersion: RESOLVED_BUILD_SCHEMA_VERSION,
    name: genericCase.name,
    kind: 'generic',
    description: genericCase.description,
    coverage: uniqueCoverage(genericCase.coverage),
    input: actualInput,
    expectedParams: expectedOutput.params,
    expectedTx: expectedOutput.txObject,
    orchestration: {
      priceRoute,
      exchangeParams,
      wethPlan: maybeWethCallData,
      approvalDecisions: capturedApprovalDecisions ?? [],
      minMaxAmount,
      quotedAmount,
    },
  };
}

async function buildDirectSuccessFixture(
  directCase: DirectCase,
): Promise<ResolvedBuildSuccessFixture> {
  const input = buildDirectInput({
    contractMethod: directCase.contractMethod,
    params: directCase.params,
    srcToken: normalizeAddress(directCase.srcToken ?? TOKEN_A),
    srcAmount: directCase.srcAmount ?? '1000',
    minMaxAmount: directCase.minMaxAmount ?? '990',
    side: directCase.side,
    gas: directCase.gas ?? GAS,
  });
  const priceRoute = buildDirectPriceRoute(directCase);
  const minMaxAmount = directCase.minMaxAmount ?? '990';
  const quotedAmount = directCase.quotedAmount ?? priceRoute.destAmount;
  const dexResult = buildDirectDexResult(directCase);
  const dexAdapterService = buildDirectDexAdapterService(directCase, dexResult);
  const capturedBuildInputs: DirectBuildInput[] = [];
  const builder = new GenericSwapTransactionBuilder(dexAdapterService, {
    resolvedBuildInputObserver: {
      onDirectBuildInput: directInput =>
        capturedBuildInputs.push(clone(directInput)),
    },
  });
  const args = buildArgsFromDirectInput(input, priceRoute, quotedAmount);
  const tx = (await builder.build(args)) as TxObject;
  const params = (await builder.build({
    ...args,
    onlyParams: true,
  })) as unknown[];
  const actualInput = getCapturedBoundaryInput(
    capturedBuildInputs,
    `${directCase.name}: captured direct DirectBuildInput parity failed`,
  );
  const expectedOutput = buildDirectTransactionFromResolved(
    actualInput,
    createDirectResolvedBuildDeps(actualInput),
  );

  assertEqual(
    actualInput,
    input,
    `${directCase.name}: authored DirectBuildInput parity failed`,
  );
  assertEqual(
    expectedOutput.txObject.data,
    dexResult.encoder(...actualInput.params),
    `${directCase.name}: direct encoder byte parity failed`,
  );
  assertEqual(
    tx,
    expectedOutput.txObject,
    `${directCase.name}: public tx parity failed`,
  );
  assertEqual(
    params,
    expectedOutput.params,
    `${directCase.name}: public onlyParams parity failed`,
  );

  return {
    schemaVersion: RESOLVED_BUILD_SCHEMA_VERSION,
    name: directCase.name,
    kind: 'direct',
    description: directCase.description,
    coverage: uniqueCoverage(directCase.coverage),
    input: actualInput,
    expectedParams: expectedOutput.params,
    expectedTx: expectedOutput.txObject,
    orchestration: {
      priceRoute,
      directDexKey: directCase.dexKey,
      directDestToken: directCase.destToken ?? TOKEN_B,
      directDestAmount: directCase.destAmount ?? '995',
      minMaxAmount,
      quotedAmount,
    },
  };
}

export async function replayPublicBuilderForFixture(
  fixture: ResolvedBuildSuccessFixture,
): Promise<{ tx: TxObject; params: unknown[] }> {
  if (!fixture.orchestration) {
    throw new Error(`${fixture.name}: missing orchestration metadata`);
  }

  return fixture.kind === 'generic'
    ? replayGenericPublicBuilder(fixture)
    : replayDirectPublicBuilder(fixture);
}

async function replayGenericPublicBuilder(
  fixture: ResolvedBuildSuccessFixture,
): Promise<{ tx: TxObject; params: unknown[] }> {
  const input = fixture.input as BuildInput;
  const orchestration = fixture.orchestration!;

  if (!orchestration.priceRoute || !orchestration.exchangeParams) {
    throw new Error(`${fixture.name}: missing generic orchestration metadata`);
  }

  const priceRoute = clone(orchestration.priceRoute);
  const approvalDecisions = orchestration.approvalDecisions ?? [];
  const dexHelper = buildDexHelper();
  const dexAdapterService = buildGenericDexAdapterService({
    priceRoute,
    dexHelper,
    exchangeParams: clone(orchestration.exchangeParams),
    maybeWethCallData: cloneWethPlan(orchestration.wethPlan),
    approvalDecision: pairs => {
      if (approvalDecisions.length !== pairs.length) {
        throw new Error(
          `${fixture.name}: approval decision length must match approval pair count`,
        );
      }
      return approvalDecisions;
    },
  });
  const builder = new GenericSwapTransactionBuilder(dexAdapterService);
  const args = buildArgsFromGenericInput(input, priceRoute);

  return {
    tx: (await builder.build(args)) as TxObject,
    params: (await builder.build({ ...args, onlyParams: true })) as unknown[],
  };
}

async function replayDirectPublicBuilder(
  fixture: ResolvedBuildSuccessFixture,
): Promise<{ tx: TxObject; params: unknown[] }> {
  const input = fixture.input as DirectBuildInput;
  const orchestration = fixture.orchestration!;

  if (!orchestration.priceRoute || !orchestration.directDexKey) {
    throw new Error(`${fixture.name}: missing direct orchestration metadata`);
  }

  const directCase: DirectCase = {
    name: fixture.name,
    coverage: fixture.coverage,
    dexKey: orchestration.directDexKey,
    contractMethod: input.contractMethod,
    side: input.side,
    params: input.params,
    srcToken: input.srcToken,
    destToken: orchestration.directDestToken,
    srcAmount: input.srcAmount,
    destAmount: orchestration.directDestAmount,
    minMaxAmount: input.minMaxAmount,
    quotedAmount: orchestration.quotedAmount,
    gas: input.gas,
  };
  const dexResult = buildDirectDexResult(directCase);
  const builder = new GenericSwapTransactionBuilder(
    buildDirectDexAdapterService(directCase, dexResult),
  );
  const priceRoute = clone(orchestration.priceRoute);
  const args = buildArgsFromDirectInput(
    input,
    priceRoute,
    orchestration.quotedAmount,
  );

  return {
    tx: (await builder.build(args)) as TxObject,
    params: (await builder.build({ ...args, onlyParams: true })) as unknown[],
  };
}

function buildNegativeFixtures(
  genericBase: ResolvedBuildSuccessFixture,
  directBase: ResolvedBuildSuccessFixture,
): ResolvedBuildFixture[] {
  const genericInput = genericBase.input as BuildInput;
  const directInput = directBase.input as DirectBuildInput;

  return [
    buildNegativeFixture({
      name: 'duplicate-resolved-leg',
      coverage: ['negative', 'validation-error', 'duplicate-resolved-leg'],
      input: mutateGenericInput(genericInput, input => {
        input.resolvedLegs.push(clone(input.resolvedLegs[0]));
      }),
    }),
    buildNegativeFixture({
      name: 'missing-resolved-leg',
      coverage: ['negative', 'validation-error', 'missing-resolved-leg'],
      input: mutateGenericInput(genericInput, input => {
        input.resolvedLegs = [];
      }),
    }),
    buildNegativeFixture({
      name: 'out-of-route-resolved-leg',
      coverage: ['negative', 'validation-error', 'out-of-route-resolved-leg'],
      input: mutateGenericInput(genericInput, input => {
        input.resolvedLegs[0].swapExchangeIndex = 1;
      }),
    }),
    buildNegativeFixture({
      name: 'malformed-address',
      coverage: ['negative', 'validation-error', 'malformed-address'],
      input: mutateGenericInput(genericInput, input => {
        input.srcToken = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      }),
    }),
    buildNegativeFixture({
      name: 'malformed-amount',
      coverage: ['negative', 'validation-error', 'malformed-amount'],
      input: mutateGenericInput(genericInput, input => {
        input.srcAmount = '1.5';
      }),
    }),
    buildNegativeFixture({
      name: 'malformed-hex-bytes',
      coverage: ['negative', 'validation-error', 'malformed-hex'],
      input: mutateGenericInput(genericInput, input => {
        input.permit = '0x1';
      }),
    }),
    buildNegativeFixture({
      name: 'non-boolean-need-wrap-native',
      coverage: [
        'negative',
        'validation-error',
        'non-boolean-need-wrap-native',
      ],
      input: mutateGenericInput(genericInput, input => {
        input.resolvedLegs[0].exchangeParam.needWrapNative =
          'true' as unknown as boolean;
      }),
    }),
    buildNegativeFixture({
      name: 'malformed-weth-plan',
      coverage: ['negative', 'validation-error', 'malformed-weth-plan'],
      input: mutateGenericInput(genericInput, input => {
        input.wethPlan = {
          deposit: {
            callee: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            calldata: '0x',
            value: '1',
          },
        };
      }),
    }),
    buildNegativeFixture({
      name: 'unsupported-generic-method',
      coverage: ['negative', 'validation-error', 'unsupported-method'],
      input: mutateGenericInput(genericInput, input => {
        input.contractMethod = ContractMethodV6.swapExactAmountInOnUniswapV2;
      }),
    }),
    buildNegativeFixture({
      name: 'executor-address-mismatch',
      coverage: ['negative', 'validation-error', 'executor-address-mismatch'],
      input: mutateGenericInput(genericInput, input => {
        input.executorAddress = '0x2222222222222222222222222222222222222222';
      }),
    }),
    buildNegativeFixture({
      name: 'unsupported-direct-method',
      coverage: ['negative', 'validation-error', 'unsupported-method'],
      input: mutateDirectInput(directInput, input => {
        input.contractMethod = ContractMethodV6.swapExactAmountIn;
      }),
    }),
    buildNegativeFixture({
      name: 'invalid-direct-side',
      coverage: ['negative', 'validation-error', 'invalid-direct-side'],
      input: mutateDirectInput(directInput, input => {
        input.side = 'INVALID' as SwapSide;
      }),
    }),
    buildNegativeFixture({
      name: 'direct-side-method-mismatch',
      coverage: ['negative', 'validation-error', 'direct-side-method-mismatch'],
      input: mutateDirectInput(directInput, input => {
        input.contractMethod = ContractMethodV6.swapExactAmountOutOnUniswapV2;
        input.side = SwapSide.SELL;
      }),
    }),
  ];
}

function buildNegativeFixture({
  name,
  coverage,
  input,
}: {
  name: string;
  coverage: CoverageTag[];
  input: BuildInput | DirectBuildInput;
}): ResolvedBuildFixture {
  return {
    schemaVersion: RESOLVED_BUILD_SCHEMA_VERSION,
    name,
    kind: 'negative',
    coverage: uniqueCoverage(coverage),
    input: clone(input),
    expectedError: captureBoundaryError(input),
  };
}

export function runBoundarySuccessFixture(
  fixture: ResolvedBuildSuccessFixture,
): { params: unknown[]; txObject: TxObject } {
  if (fixture.kind === 'generic') {
    const input = fixture.input as BuildInput;
    const output = buildTransactionFromResolved(
      input,
      createResolvedBuildDeps(input),
    );

    return {
      params: output.params,
      txObject: output.txObject,
    };
  }

  const input = fixture.input as DirectBuildInput;
  const output = buildDirectTransactionFromResolved(
    input,
    createDirectResolvedBuildDeps(input),
  );

  return {
    params: output.params,
    txObject: output.txObject,
  };
}

export function captureBoundaryError(
  input: BuildInput | DirectBuildInput,
): string {
  try {
    if (isBuildInput(input)) {
      buildTransactionFromResolved(input, createResolvedBuildDeps(input));
    } else {
      buildDirectTransactionFromResolved(
        input,
        createDirectResolvedBuildDeps(input),
      );
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error('negative fixture did not throw');
}

function buildExpectedInput({
  priceRoute,
  minMaxAmount,
  quotedAmount,
  gas,
  dexHelper,
  builder,
  executorType,
  exchangeParams,
  maybeWethCallData,
  approvalDecision,
  genericCase,
}: {
  priceRoute: OptimalRate;
  minMaxAmount: string;
  quotedAmount: string;
  gas: BuildInput['gas'];
  dexHelper: ReturnType<typeof buildDexHelper>;
  builder: GenericSwapTransactionBuilder;
  executorType: Executors;
  exchangeParams: DexExchangeBuildParam[];
  maybeWethCallData?: DepositWithdrawReturn;
  approvalDecision: ApprovalDecision;
  genericCase: GenericCase;
}): ExpectedInputResult {
  const routePlan = buildRoutePlan(priceRoute);
  const routePositions = walkRoutePlan(routePlan);
  const encodingContext = createExecutorEncodingContextFromDexHelper(dexHelper);
  const executorAddress = encodingContext.executorsAddresses[executorType];

  if (exchangeParams.length !== routePositions.length) {
    throw new Error('exchange params length must match route positions');
  }

  const resolvedLegsWithoutApprovals = routePositions.map(
    (routePosition, index): ResolvedLeg => {
      const { routeIndex, swapIndex, swapExchangeIndex } = routePosition;
      const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
      const swapExchange = swap.swapExchanges[swapExchangeIndex];
      const exchangeParam = normalizeDexExchangeBuildParam(
        clone(exchangeParams[index]),
      );
      const { srcToken, destToken, srcAmount, destAmount, recipient } =
        builder.getDexCallsParams(
          priceRoute,
          routeIndex,
          swap,
          swapIndex,
          swapExchange,
          minMaxAmount,
          exchangeParam.needWrapNative,
          executorAddress,
        );

      return {
        routeIndex,
        swapIndex,
        swapExchangeIndex,
        exchangeParam,
        normalizedSrcToken: normalizeAddress(srcToken),
        normalizedDestToken: normalizeAddress(destToken),
        normalizedSrcAmount: srcAmount,
        normalizedDestAmount: destAmount,
        recipient: normalizeAddress(recipient),
      };
    },
  );
  const approvalResult = addApprovalData({
    encodingContext,
    priceRoute,
    routePlan,
    resolvedLegs: resolvedLegsWithoutApprovals,
    approvalDecision,
  });
  const fee = {
    partnerAddress: normalizeAddress(
      genericCase.partnerAddress ?? NULL_ADDRESS,
    ),
    partnerFeePercent: genericCase.partnerFeePercent ?? '0',
    referrerAddress:
      genericCase.referrerAddress === undefined
        ? undefined
        : normalizeAddress(genericCase.referrerAddress),
    takeSurplus: genericCase.takeSurplus ?? false,
    isCapSurplus: genericCase.isCapSurplus ?? true,
    isSurplusToUser: genericCase.isSurplusToUser ?? false,
    isDirectFeeTransfer: genericCase.isDirectFeeTransfer ?? false,
  };

  return {
    approvalPairs: approvalResult.approvalPairs,
    approvalDecisions: approvalResult.approvalDecisions,
    input: {
      routePlan,
      resolvedLegs: approvalResult.resolvedLegs,
      wethPlan: normalizeWethPlan(maybeWethCallData),
      executorType,
      executorAddress: normalizeAddress(executorAddress),
      augustusV6Address: normalizeAddress(
        dexHelper.config.data.augustusV6Address!,
      ),
      wrappedNativeTokenAddress: normalizeAddress(
        dexHelper.config.data.wrappedNativeTokenAddress,
      ),
      network: priceRoute.network,
      srcToken: normalizeAddress(priceRoute.srcToken),
      destToken: normalizeAddress(priceRoute.destToken),
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      minMaxAmount,
      quotedAmount,
      side: priceRoute.side,
      contractMethod: priceRoute.contractMethod as ContractMethodV6,
      blockNumber: priceRoute.blockNumber,
      userAddress: USER_ADDRESS,
      beneficiary: normalizeAddress(genericCase.beneficiary ?? NULL_ADDRESS),
      permit: genericCase.permit ?? '0x',
      uuid: genericCase.uuid ?? UUID,
      fee,
      gas,
    },
  };
}

function addApprovalData({
  encodingContext,
  priceRoute,
  routePlan,
  resolvedLegs,
  approvalDecision,
}: {
  encodingContext: ExecutorEncodingContext;
  priceRoute: OptimalRate;
  routePlan: BuildInput['routePlan'];
  resolvedLegs: ResolvedLeg[];
  approvalDecision: ApprovalDecision;
}): {
  resolvedLegs: ResolvedLeg[];
  approvalPairs: ApprovalPair[];
  approvalDecisions: boolean[];
} {
  const resolvedLegByKey = new Map(
    resolvedLegs.map(resolvedLeg => [
      routePositionKey(resolvedLeg),
      resolvedLeg,
    ]),
  );
  const approvalTargets: { key: string; params: ApprovalPair }[] = [];

  walkRoutePlan(routePlan).forEach(routePosition => {
    const key = routePositionKey(routePosition);
    const resolvedLeg = resolvedLegByKey.get(key);

    if (!resolvedLeg) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }

    const swap =
      priceRoute.bestRoute[routePosition.routeIndex].swaps[
        routePosition.swapIndex
      ];
    const approveParams = getApprovalTokenAndTarget(
      swap,
      resolvedLeg.exchangeParam,
      encodingContext,
    );

    if (approveParams) {
      approvalTargets.push({
        key,
        params: [
          normalizeAddress(approveParams.token),
          normalizeAddress(approveParams.target),
          !!resolvedLeg.exchangeParam.permit2Approval,
        ],
      });
    }
  });

  const approvalPairs = approvalTargets.map(target => target.params);
  const approvalDecisions = approvalDecision(approvalPairs);

  if (approvalDecisions.length !== approvalPairs.length) {
    throw new Error('approval decision length must match approval pair count');
  }

  approvalDecisions.forEach((alreadyApproved, index) => {
    if (alreadyApproved) return;

    const { key, params } = approvalTargets[index];
    const resolvedLeg = resolvedLegByKey.get(key);

    if (!resolvedLeg) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }

    const [token, target] = params;
    resolvedLegByKey.set(key, {
      ...resolvedLeg,
      exchangeParam: {
        ...resolvedLeg.exchangeParam,
        approveData: { token, target },
      },
    });
  });

  return {
    approvalPairs,
    approvalDecisions,
    resolvedLegs: resolvedLegs.map(resolvedLeg => {
      const key = routePositionKey(resolvedLeg);
      const updatedLeg = resolvedLegByKey.get(key);

      if (!updatedLeg) {
        throw new Error(`missing resolved leg for route position ${key}`);
      }

      return updatedLeg;
    }),
  };
}

function buildExecutor02MegaSwapCase(
  routeFixture: string,
  exchangeParamsFixture: string,
  wethFixture: string,
  secondRouteFixture: string,
  secondExchangeParamsFixture: string,
  secondWethFixture: string,
): GenericCase {
  const firstPriceRoute = buildPriceRouteFromFixture(routeFixture);
  const secondPriceRoute = buildPriceRouteFromFixture(secondRouteFixture);
  const firstRoute = clone(firstPriceRoute.bestRoute[0]);
  const secondRoute = clone(secondPriceRoute.bestRoute[0]);
  const firstWethPlan = buildWethPlan(wethFixture);
  const secondWethPlan = buildWethPlan(secondWethFixture);

  firstRoute.percent = 91;
  secondRoute.percent = 9;

  return {
    name: 'executor02-megaswap-sell',
    description:
      'Authored Executor02 mega swap with heterogeneous top-level ETH-USDC routes.',
    coverage: [
      'generic',
      'executor02',
      'mega-swap',
      'vertical-branch',
      'sell',
      'weth-deposit',
    ],
    priceRoute: {
      ...firstPriceRoute,
      srcAmount: (
        BigInt(firstPriceRoute.srcAmount) + BigInt(secondPriceRoute.srcAmount)
      ).toString(),
      destAmount: (
        BigInt(firstPriceRoute.destAmount) + BigInt(secondPriceRoute.destAmount)
      ).toString(),
      bestRoute: [firstRoute, secondRoute],
    },
    exchangeParams: [
      ...buildExchangeParams(exchangeParamsFixture),
      ...buildExchangeParams(secondExchangeParamsFixture),
    ],
    maybeWethCallData: mergeDepositOnlyWethPlans(firstWethPlan, secondWethPlan),
  };
}

function mergeDepositOnlyWethPlans(
  firstWethPlan: DepositWithdrawReturn,
  secondWethPlan: DepositWithdrawReturn,
): DepositWithdrawReturn {
  if (!firstWethPlan.deposit || !secondWethPlan.deposit) {
    throw new Error('mega-swap fixture expects two WETH deposit plans');
  }

  if (
    firstWethPlan.deposit.callee !== secondWethPlan.deposit.callee ||
    firstWethPlan.deposit.calldata !== secondWethPlan.deposit.calldata
  ) {
    throw new Error('mega-swap fixture WETH deposit plans must match calldata');
  }

  return {
    deposit: {
      ...firstWethPlan.deposit,
      value: (
        BigInt(firstWethPlan.deposit.value) +
        BigInt(secondWethPlan.deposit.value)
      ).toString(),
    },
  };
}

function buildPriceRouteFromFixture(
  fixturePath: string,
  overrides: Partial<OptimalRate> = {},
): OptimalRate {
  return buildTestPriceRoute({
    ...(loadFixtureJson(fixturePath) as OptimalRate),
    contractMethod: ContractMethodV6.swapExactAmountIn,
    ...overrides,
  });
}

function buildTestPriceRoute(partial: Partial<OptimalRate>): OptimalRate {
  return {
    blockNumber: 1,
    network: Network.MAINNET,
    srcToken: ETHER_ADDRESS,
    srcDecimals: 18,
    srcAmount: '1',
    srcUSD: '0',
    destToken: WRAPPED_NATIVE_TOKEN_ADDRESS,
    destDecimals: 18,
    destAmount: '1',
    destUSD: '0',
    bestRoute: [],
    gasCostUSD: '0',
    gasCost: '0',
    side: SwapSide.SELL,
    contractMethod: ContractMethodV6.swapExactAmountIn,
    tokenTransferProxy: NULL_ADDRESS,
    contractAddress: AUGUSTUS_V6_ADDRESS,
    partnerFee: 0,
    hmac: '',
    version: ParaSwapVersion.V6,
    ...partial,
  } as OptimalRate;
}

function buildExchangeParams(fixturePath: string): DexExchangeBuildParam[] {
  return clone(loadFixtureJson(fixturePath)) as DexExchangeBuildParam[];
}

function buildWethPlan(fixturePath: string): DepositWithdrawReturn {
  return clone(loadFixtureJson(fixturePath)) as DepositWithdrawReturn;
}

function buildWethOnlyPriceRoute(): OptimalRate {
  return buildTestPriceRoute({
    blockNumber: 1,
    network: Network.MAINNET,
    srcToken: ETHER_ADDRESS,
    srcDecimals: 18,
    srcAmount: '1000000000000000000',
    srcUSD: '1000',
    destToken: WRAPPED_NATIVE_TOKEN_ADDRESS,
    destDecimals: 18,
    destAmount: '1000000000000000000',
    destUSD: '1000',
    bestRoute: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: ETHER_ADDRESS,
            srcDecimals: 18,
            destToken: WRAPPED_NATIVE_TOKEN_ADDRESS,
            destDecimals: 18,
            swapExchanges: [
              {
                exchange: WETH_DEX_KEY,
                srcAmount: '1000000000000000000',
                destAmount: '1000000000000000000',
                percent: 100,
                poolAddresses: [WRAPPED_NATIVE_TOKEN_ADDRESS],
                data: null,
              },
            ],
          },
        ],
      },
    ],
    side: SwapSide.SELL,
    contractMethod: ContractMethodV6.swapExactAmountIn,
  });
}

function buildWethOnlyExchangeParam(): DexExchangeBuildParam {
  return {
    needWrapNative: false,
    dexFuncHasRecipient: false,
    exchangeData: '0xd0e30db0',
    targetExchange: WRAPPED_NATIVE_TOKEN_ADDRESS,
  };
}

function buildArgsFromGenericCase({
  priceRoute,
  minMaxAmount,
  quotedAmount,
  gas,
  genericCase,
}: {
  priceRoute: OptimalRate;
  minMaxAmount: string;
  quotedAmount: string;
  gas: BuildInput['gas'];
  genericCase: GenericCase;
}) {
  return {
    priceRoute,
    minMaxAmount,
    quotedAmount,
    userAddress: USER_ADDRESS,
    referrerAddress: genericCase.referrerAddress,
    partnerAddress: normalizeAddress(
      genericCase.partnerAddress ?? NULL_ADDRESS,
    ),
    partnerFeePercent: genericCase.partnerFeePercent ?? '0',
    takeSurplus: genericCase.takeSurplus ?? false,
    isCapSurplus: genericCase.isCapSurplus ?? true,
    isSurplusToUser: genericCase.isSurplusToUser ?? false,
    isDirectFeeTransfer: genericCase.isDirectFeeTransfer ?? false,
    gasPrice: gas?.gasPrice,
    maxFeePerGas: gas?.maxFeePerGas,
    maxPriorityFeePerGas: gas?.maxPriorityFeePerGas,
    permit: genericCase.permit ?? '0x',
    deadline: '0',
    uuid: genericCase.uuid ?? UUID,
    beneficiary: genericCase.beneficiary ?? NULL_ADDRESS,
  };
}

// Public-builder replay reconstructs wrapper args from serialized boundary
// input. Keep this bridge in sync with BuildInput when boundary fields change.
function buildArgsFromGenericInput(input: BuildInput, priceRoute: OptimalRate) {
  return {
    priceRoute,
    minMaxAmount: input.minMaxAmount,
    quotedAmount: input.quotedAmount,
    userAddress: input.userAddress,
    referrerAddress: input.fee.referrerAddress,
    partnerAddress: input.fee.partnerAddress,
    partnerFeePercent: input.fee.partnerFeePercent,
    takeSurplus: input.fee.takeSurplus,
    isCapSurplus: input.fee.isCapSurplus,
    isSurplusToUser: input.fee.isSurplusToUser,
    isDirectFeeTransfer: input.fee.isDirectFeeTransfer,
    gasPrice: input.gas?.gasPrice,
    maxFeePerGas: input.gas?.maxFeePerGas,
    maxPriorityFeePerGas: input.gas?.maxPriorityFeePerGas,
    permit: input.permit,
    deadline: '0',
    uuid: input.uuid,
    beneficiary: input.beneficiary,
  };
}

function buildArgsFromDirectInput(
  input: DirectBuildInput,
  priceRoute: OptimalRate,
  quotedAmount?: string,
) {
  return {
    priceRoute,
    minMaxAmount: input.minMaxAmount,
    quotedAmount,
    userAddress: input.userAddress,
    partnerAddress: NULL_ADDRESS,
    partnerFeePercent: '0',
    takeSurplus: false,
    isCapSurplus: false,
    isSurplusToUser: false,
    isDirectFeeTransfer: false,
    gasPrice: input.gas?.gasPrice,
    maxFeePerGas: input.gas?.maxFeePerGas,
    maxPriorityFeePerGas: input.gas?.maxPriorityFeePerGas,
    permit: '0x',
    deadline: '0',
    uuid: UUID,
    beneficiary: NULL_ADDRESS,
  };
}

function buildGenericDexAdapterService({
  priceRoute,
  dexHelper,
  exchangeParams,
  maybeWethCallData,
  approvalDecision,
}: {
  priceRoute: OptimalRate;
  dexHelper: ReturnType<typeof buildDexHelper>;
  exchangeParams: DexExchangeBuildParam[];
  maybeWethCallData?: DepositWithdrawReturn;
  approvalDecision: ApprovalDecision;
}): DexAdapterService {
  const routePlan = buildRoutePlan(priceRoute);
  const routeDexFixtures = walkRoutePlan(routePlan).map(
    (routePosition, index): RouteDexFixture => {
      const swap =
        priceRoute.bestRoute[routePosition.routeIndex].swaps[
          routePosition.swapIndex
        ];
      const swapExchange = swap.swapExchanges[routePosition.swapExchangeIndex];

      return {
        exchange: swapExchange.exchange,
        swap,
        swapExchange,
        exchangeParam: clone(exchangeParams[index]),
      };
    },
  );

  dexHelper.augustusApprovals.hasApprovals = async (
    _spender: string,
    pairs: ApprovalPair[],
  ) => approvalDecision(pairs);

  return {
    network: priceRoute.network,
    dexHelper,
    isDirectFunctionNameV6: () => false,
    getTxBuilderDexByKey: (dexKey: string) => {
      if (routeDexFixtures.some(fixture => fixture.exchange === dexKey)) {
        return {
          needWrapNative: (
            _priceRoute: OptimalRate,
            swap: OptimalSwap,
            swapExchange: OptimalSwapExchange<any>,
          ) =>
            findRouteDexFixtureByRoute(
              routeDexFixtures,
              dexKey,
              swap,
              swapExchange,
            ).exchangeParam.needWrapNative,
          getDexParam: async (
            _srcToken: Address,
            _destToken: Address,
            _srcAmount: string,
            _destAmount: string,
            _recipient: Address,
            data: unknown,
          ) =>
            clone(
              findRouteDexFixtureByData(routeDexFixtures, dexKey, data)
                .exchangeParam,
            ),
        };
      }

      if (dexKey === WETH_DEX_KEY) {
        return {
          needWrapNative: false,
          getDexParam: async () => buildWethOnlyExchangeParam(),
          getDepositWithdrawParam: () => cloneWethPlan(maybeWethCallData),
        };
      }

      throw new Error(`unexpected DEX lookup in fixture: ${dexKey}`);
    },
  } as unknown as DexAdapterService;
}

function buildDirectDexAdapterService(
  directCase: DirectCase,
  dexResult: TxInfo<unknown[]>,
): DexAdapterService {
  const dexHelper = buildDexHelper();
  const directDex = {
    needWrapNative: false,
    getDirectParamV6: () => dexResult,
  };

  return {
    network: Network.MAINNET,
    dexHelper,
    isDirectFunctionNameV6: (contractMethod: ContractMethodV6) =>
      contractMethod === directCase.contractMethod,
    getTxBuilderDexByKey: (dexKey: string) => {
      if (dexKey === directCase.dexKey) return directDex;
      throw new Error(`unexpected direct DEX lookup in fixture: ${dexKey}`);
    },
  } as unknown as DexAdapterService;
}

function findRouteDexFixtureByRoute(
  routeDexFixtures: RouteDexFixture[],
  dexKey: string,
  swap: OptimalSwap,
  swapExchange: OptimalSwapExchange<any>,
): RouteDexFixture {
  const fixture = routeDexFixtures.find(
    candidate =>
      candidate.exchange === dexKey &&
      candidate.swap === swap &&
      candidate.swapExchange === swapExchange,
  );

  if (!fixture) {
    throw new Error(`unexpected route-position DEX lookup: ${dexKey}`);
  }

  return fixture;
}

function findRouteDexFixtureByData(
  routeDexFixtures: RouteDexFixture[],
  dexKey: string,
  data: unknown,
): RouteDexFixture {
  const fixture = routeDexFixtures.find(
    candidate =>
      candidate.exchange === dexKey && candidate.swapExchange.data === data,
  );

  if (!fixture) {
    throw new Error(`unexpected getDexParam lookup: ${dexKey}`);
  }

  return fixture;
}

function buildDexHelper() {
  return {
    config: {
      data: {
        network: Network.MAINNET,
        augustusV6Address: AUGUSTUS_V6_ADDRESS,
        wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        executorsAddresses: {
          [Executors.ONE]: EXECUTOR_01_ADDRESS,
          [Executors.TWO]: EXECUTOR_02_ADDRESS,
          [Executors.THREE]: EXECUTOR_03_ADDRESS,
        },
      },
      isWETH: (token: string) =>
        token.toLowerCase() === WRAPPED_NATIVE_TOKEN_ADDRESS,
    },
    augustusApprovals: {
      hasApprovals: async () => [],
    },
    getLogger: () => ({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
  } as any;
}

function buildDirectPriceRoute(directCase: DirectCase): OptimalRate {
  const srcToken = directCase.srcToken ?? TOKEN_A;
  const destToken = directCase.destToken ?? TOKEN_B;
  const srcAmount = directCase.srcAmount ?? '1000';
  const destAmount = directCase.destAmount ?? '995';

  return buildTestPriceRoute({
    srcToken,
    srcAmount,
    destToken,
    destAmount,
    side: directCase.side,
    contractMethod: directCase.contractMethod,
    bestRoute: [
      {
        percent: 100,
        swaps: [
          {
            srcToken,
            srcDecimals: 18,
            destToken,
            destDecimals: 18,
            swapExchanges: [
              {
                exchange: directCase.dexKey,
                srcAmount,
                destAmount,
                percent: 100,
                poolAddresses: [POOL_ADDRESS],
                data: { directCase: directCase.name },
              },
            ],
          },
        ],
      },
    ],
  });
}

function buildDirectInput({
  contractMethod = ContractMethodV6.swapExactAmountInOnUniswapV2,
  params,
  srcToken = TOKEN_A,
  srcAmount = '1000',
  minMaxAmount = '990',
  side = SwapSide.SELL,
  gas = GAS,
}: Partial<DirectBuildInput> & { params: unknown[] }): DirectBuildInput {
  return {
    contractMethod,
    params,
    userAddress: USER_ADDRESS,
    augustusV6Address: AUGUSTUS_V6_ADDRESS,
    srcToken,
    srcAmount,
    minMaxAmount,
    side,
    gas,
  };
}

function buildDirectDexResult(directCase: DirectCase): TxInfo<unknown[]> {
  return {
    params: directCase.params,
    encoder: (...encoderParams: unknown[]) =>
      AUGUSTUS_V6_INTERFACE.encodeFunctionData(
        getSideDerivedEncoderMethod(directCase),
        encoderParams,
      ),
    networkFee: '0',
  };
}

function getSideDerivedEncoderMethod(directCase: DirectCase): ContractMethodV6 {
  if (
    directCase.contractMethod ===
      ContractMethodV6.swapExactAmountInOnUniswapV2 ||
    directCase.contractMethod === ContractMethodV6.swapExactAmountOutOnUniswapV2
  ) {
    return directCase.side === SwapSide.SELL
      ? ContractMethodV6.swapExactAmountInOnUniswapV2
      : ContractMethodV6.swapExactAmountOutOnUniswapV2;
  }

  if (
    directCase.contractMethod ===
      ContractMethodV6.swapExactAmountInOnUniswapV3 ||
    directCase.contractMethod === ContractMethodV6.swapExactAmountOutOnUniswapV3
  ) {
    return directCase.side === SwapSide.SELL
      ? ContractMethodV6.swapExactAmountInOnUniswapV3
      : ContractMethodV6.swapExactAmountOutOnUniswapV3;
  }

  if (
    directCase.contractMethod ===
      ContractMethodV6.swapExactAmountInOnBalancerV2 ||
    directCase.contractMethod ===
      ContractMethodV6.swapExactAmountOutOnBalancerV2
  ) {
    return directCase.side === SwapSide.SELL
      ? ContractMethodV6.swapExactAmountInOnBalancerV2
      : ContractMethodV6.swapExactAmountOutOnBalancerV2;
  }

  return directCase.contractMethod;
}

function buildUniParams(
  srcToken: Address,
  destToken: Address,
  fromAmount: string,
  toAmount: string,
  quotedAmount: string,
): unknown[] {
  return [
    [
      srcToken,
      destToken,
      fromAmount,
      toAmount,
      quotedAmount,
      METADATA,
      NULL_ADDRESS,
      '0x1234',
    ],
    '0',
    '0x',
  ];
}

function getMinMaxAmount(
  priceRoute: OptimalRate,
  minMaxAmount?: string,
): string {
  if (minMaxAmount !== undefined) return minMaxAmount;
  return priceRoute.side === SwapSide.SELL
    ? MIN_MAX_AMOUNT
    : priceRoute.srcAmount;
}

function getQuotedAmount(
  priceRoute: OptimalRate,
  quotedAmount?: string,
): string {
  if (quotedAmount !== undefined) return quotedAmount;
  return priceRoute.side === SwapSide.SELL
    ? priceRoute.destAmount
    : priceRoute.srcAmount;
}

function normalizeDexExchangeBuildParam(
  exchangeParam: DexExchangeBuildParam,
): DexExchangeBuildParam {
  return {
    ...exchangeParam,
    targetExchange: normalizeAddress(exchangeParam.targetExchange),
    wethAddress: normalizeOptionalAddress(exchangeParam.wethAddress),
    transferSrcTokenBeforeSwap: normalizeOptionalAddress(
      exchangeParam.transferSrcTokenBeforeSwap,
    ),
    spender: normalizeOptionalAddress(exchangeParam.spender),
    approveData:
      exchangeParam.approveData === undefined
        ? undefined
        : {
            token: normalizeAddress(exchangeParam.approveData.token),
            target: normalizeAddress(exchangeParam.approveData.target),
          },
  };
}

function normalizeWethPlan(
  wethPlan?: DepositWithdrawReturn,
): DepositWithdrawReturn | undefined {
  if (!wethPlan) return undefined;

  return {
    deposit:
      wethPlan.deposit === undefined
        ? undefined
        : {
            ...wethPlan.deposit,
            callee: normalizeAddress(wethPlan.deposit.callee),
          },
    withdraw:
      wethPlan.withdraw === undefined
        ? undefined
        : {
            ...wethPlan.withdraw,
            callee: normalizeAddress(wethPlan.withdraw.callee),
          },
  };
}

function normalizeOptionalAddress<T extends string | undefined>(address: T): T {
  return (address === undefined ? undefined : normalizeAddress(address)) as T;
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase();
}

function cloneWethPlan<T extends DepositWithdrawReturn | undefined>(
  value: T,
): T {
  return clone(value);
}

function mutateGenericInput(
  base: BuildInput,
  mutate: (input: BuildInput) => void,
): BuildInput {
  const input = clone(base);
  mutate(input);
  return input;
}

function mutateDirectInput(
  base: DirectBuildInput,
  mutate: (input: DirectBuildInput) => void,
): DirectBuildInput {
  const input = clone(base);
  mutate(input);
  return input;
}

function isBuildInput(
  input: BuildInput | DirectBuildInput,
): input is BuildInput {
  return (input as BuildInput).routePlan !== undefined;
}

function uniqueCoverage(coverage: CoverageTag[]): CoverageTag[] {
  return [...new Set(coverage)];
}

function loadFixtureJson(fixturePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_ROOT, fixturePath), 'utf8'),
  ) as unknown;
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

function getCapturedBoundaryInput<T>(capturedInputs: T[], message: string): T {
  if (capturedInputs.length !== 2) {
    throw new Error(`${message}: expected 2 captured inputs`);
  }

  assertEqual(capturedInputs[1], capturedInputs[0], message);

  return capturedInputs[0];
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
