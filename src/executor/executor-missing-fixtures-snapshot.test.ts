import dotenv from 'dotenv';
dotenv.config();

import { BigNumber, ethers } from 'ethers';
import { Network, NULL_ADDRESS, SwapSide } from '../constants';
import { DexExchangeBuildParam } from '../types';
import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { Executor02BytecodeBuilder } from './Executor02BytecodeBuilder';
import { Executor03BytecodeBuilder } from './Executor03BytecodeBuilder';
import { SpecialDex } from './types';
import {
  asDexExchangeBuildParams,
  buildExecutorSnapshotInput,
  createExecutorDexHelper,
  createExecutorSnapshotContext,
} from './__test-utils__/snapshot-test-helpers';
import { OptimalRate } from '@paraswap/core';
import { Tessera } from '../dex/tessera/tessera';
import { Metric } from '../dex/metric/metric';

import executor01SimpleSellRoute from './fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
import executor01SimpleSellParams from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-usdt.json';
import executor01NativeSellRoute from './fixtures/executor01/routes/price-route-simpleSwap-balancerv1-eth-usdc.json';
import executor01NativeSellParams from './fixtures/executor01/exchange-params/price-route-simpleSwap-balancerv1-eth-usdc.json';
import executor01WethDepositRoute from './fixtures/executor01/routes/price-route-simpleSwap-univ3-eth-usdc.json';
import executor01WethDepositParams from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-eth-usdc.json';
import executor01WethDepositPlan from './fixtures/executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-eth-usdc.json';

import executor02VerticalRoute from './fixtures/executor02/routes/price-route-simpleSwap-univ3-curvev1-usdt-dai.json';
import executor02VerticalParams from './fixtures/executor02/exchange-params/price-route-simpleSwap-univ3-curvev1-usdt-dai.json';
import executor02NativeDestRoute from './fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-usdc-eth.json';
import executor02NativeDestParams from './fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-balancerv1-usdc-eth.json';
import executor02NativeDestWethPlan from './fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-balancerv1-usdc-eth.json';
import executor02NativeSrcRoute from './fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02NativeSrcParams from './fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02NativeSrcWethPlan from './fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02MultiSwapRoute from './fixtures/executor02/routes/price-route-multiswap-univ3-usdt-dai-eth.json';
import executor02MultiSwapParams from './fixtures/executor02/exchange-params/price-route-multiswap-univ3-usdt-dai-eth.json';
import executor02MultiSwapWethPlan from './fixtures/executor02/maybe-weth-calldata/price-route-multiswap-univ3-usdt-dai-eth.json';

const {
  utils: { defaultAbiCoder, hexConcat, hexZeroPad },
} = ethers;

type Mutation = (params: DexExchangeBuildParam[], route: OptimalRate) => void;

const CUSTOM_WETH_ADDRESS = '0x1111111111111111111111111111111111111111';
const TRANSFER_TARGET = '0x2222222222222222222222222222222222222222';
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const RA6_FAKE_NOW_MS = 1_700_000_000_000;

const downstreamMetricRoute = {
  blockNumber: 46237717,
  network: 8453,
  srcToken: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  srcDecimals: 8,
  srcAmount: '1768600',
  destToken: '0x4200000000000000000000000000000000000006',
  destDecimals: 18,
  destAmount: '641701781527511533',
  bestRoute: [
    {
      percent: 100,
      swaps: [
        {
          srcToken: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
          srcDecimals: 8,
          destToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          destDecimals: 6,
          swapExchanges: [
            {
              exchange: 'tessera',
              srcAmount: '1768600',
              destAmount: '1365393592',
              percent: 100,
              poolAddresses: ['0xed57bacdc2a990b631f8817853935791c122c356'],
              poolIdentifiers: [
                'tessera_0xed57bacdc2a990b631f8817853935791c122c356',
              ],
              data: {
                apiGo: true,
                blockNumber: 46237711,
                source: 'L1',
                gasUSD: '0.012975',
              },
            },
          ],
        },
        {
          srcToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          srcDecimals: 6,
          destToken: '0x4200000000000000000000000000000000000006',
          destDecimals: 18,
          swapExchanges: [
            {
              exchange: 'metric',
              srcAmount: '1365393592',
              destAmount: '641701781527511533',
              percent: 100,
              poolAddresses: ['0x770004fe4411e42ea51a7fcaca32b267d791f3d4'],
              poolIdentifiers: [
                'metric_0x770004fe4411e42ea51a7fcaca32b267d791f3d4',
              ],
              data: {
                apiGo: true,
                blockNumber: 0,
                source: 'L1',
                askPriceX64: '39250383425669585183551',
                bidPriceX64: '39248813442097150718796',
                onchainToken0: '0x4200000000000000000000000000000000000006',
                pool: '0x770004fe4411e42ea51a7fcaca32b267d791f3d4',
                zeroForOne: false,
                gasUSD: '0.001946',
              },
            },
          ],
        },
      ],
    },
  ],
  gasCostUSD: '0.015579',
  gasCost: '1199740',
  side: SwapSide.SELL,
  version: '6.2',
  contractAddress: '0x6a000f20005980200259b80c5102003040001068',
  tokenTransferProxy: '0x6a000f20005980200259b80c5102003040001068',
  contractMethod: 'swapExactAmountIn',
  partnerFee: 0.15,
  srcUSD: '1365.8367220000',
  destUSD: '1366.1381737474',
  maxImpact: 100,
  destAmountAfterFee: '640739228855220266',
  partner: 'paraswap.io',
  maxImpactReached: false,
  hmac: '68484911922031721caf935866932839f27c1dce',
} as unknown as OptimalRate;

const emittedSpecialDexFlags = [
  SpecialDex.SWAP_ON_SWAAP_V2_SINGLE,
  SpecialDex.SWAP_ON_BALANCER_V1,
  SpecialDex.SWAP_ON_MAKER_PSM,
  SpecialDex.SWAP_ON_BALANCER_V2,
  SpecialDex.SWAP_ON_UNISWAP_V2_FORK,
  SpecialDex.SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK,
  SpecialDex.SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK_WITH_FEE,
  SpecialDex.SWAP_ON_AUGUSTUS_RFQ,
  SpecialDex.BUY_ON_SOLIDLY_V3,
  SpecialDex.SWAP_ON_DEXALOT,
  SpecialDex.SWAP_ON_HASHFLOW,
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildCase(
  routeFixture: unknown,
  paramsFixture: unknown,
  mutate: Mutation,
): {
  route: OptimalRate;
  params: DexExchangeBuildParam[];
} {
  const route = clone(routeFixture) as unknown as OptimalRate;
  const params = asDexExchangeBuildParams(clone(paramsFixture));
  mutate(params, route);
  return { route, params };
}

function buildExecutor03BuyRoute(): OptimalRate {
  const route = clone(executor01SimpleSellRoute) as unknown as OptimalRate;
  route.side = SwapSide.BUY;
  route.contractMethod = 'swapExactAmountOut';
  return route;
}

function oneExchangeRoute(
  routeFixture: unknown,
  paramsFixture: unknown,
  exchangeIndex = 0,
): {
  route: OptimalRate;
  params: DexExchangeBuildParam[];
} {
  const route = clone(routeFixture) as unknown as OptimalRate;
  const params = asDexExchangeBuildParams(clone(paramsFixture));
  route.bestRoute[0].swaps[0].swapExchanges = [
    route.bestRoute[0].swaps[0].swapExchanges[exchangeIndex],
  ];
  return { route, params: [params[exchangeIndex]] };
}

function twoExchangeRoute(
  routeFixture: unknown,
  paramsFixture: unknown,
): {
  route: OptimalRate;
  params: DexExchangeBuildParam[];
} {
  const route = clone(routeFixture) as unknown as OptimalRate;
  const params = asDexExchangeBuildParams(clone(paramsFixture));
  route.bestRoute[0].swaps[0].swapExchanges =
    route.bestRoute[0].swaps[0].swapExchanges.slice(0, 2);
  return { route, params: params.slice(0, 2) };
}

function withApproval(
  param: DexExchangeBuildParam,
  token: string,
  target = param.targetExchange,
): void {
  param.approveData = {
    target,
    token,
  };
}

function withSourceToken(route: OptimalRate, token: string): void {
  route.srcToken = token;
  route.bestRoute[0].swaps[0].srcToken = token;
}

function withDestToken(route: OptimalRate, token: string): void {
  route.destToken = token;
  route.bestRoute[0].swaps[0].destToken = token;
}

function createDexBuilderHelper(network: Network) {
  return {
    ...createExecutorDexHelper(network),
    web3Provider: {
      eth: {
        Contract: function Contract() {
          return {};
        },
      },
    },
  };
}

function withPackedInt128Amounts(
  params: DexExchangeBuildParam[],
  route: OptimalRate,
  negative: boolean,
): void {
  const swapExchange = route.bestRoute[0].swaps[0].swapExchanges[0];
  const encodeInt128 = (amount: string) => {
    const value = BigNumber.from(amount);
    const encoded = negative ? value.mul(-1).toTwos(128) : value.toTwos(128);
    return hexZeroPad(encoded.toHexString(), 16);
  };

  params[0].amountsPacked128 = true;
  params[0].exchangeData = hexConcat([
    '0x12345678',
    hexZeroPad(encodeInt128(swapExchange.srcAmount), 32),
    hexZeroPad(encodeInt128(swapExchange.destAmount), 32),
  ]);
}

describe('missing executor TS parity fixtures', () => {
  const context = createExecutorSnapshotContext(Network.MAINNET);

  it('records Executor01 reference bytecode for return/insert/flag overrides', () => {
    const builder = new Executor01BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    for (const testCase of [
      {
        name: 'returnAmountPos=0',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].returnAmountPos = 0;
        },
      },
      {
        name: 'returnAmountPos=7',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].returnAmountPos = 7;
        },
      },
      {
        name: 'insertFromAmountPos=68',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 68;
        },
      },
      {
        name: 'insertFromAmountPos=65535',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 65535;
        },
      },
      {
        name: 'sendEthButSupportsInsertFromAmount=true',
        route: executor01NativeSellRoute,
        params: executor01NativeSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].sendEthButSupportsInsertFromAmount = true;
        },
      },
      {
        name: 'swappedAmountNotPresentInExchangeData=true',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].swappedAmountNotPresentInExchangeData = true;
        },
      },
      {
        name: 'insertFromAmountPos ignored when flag does not insert',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 68;
          params[0].swappedAmountNotPresentInExchangeData = true;
        },
      },
      {
        name: 'specialDexSupportsInsertFromAmount=true',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].specialDexFlag = SpecialDex.SWAP_ON_BALANCER_V1;
          params[0].specialDexSupportsInsertFromAmount = true;
        },
      },
      {
        name: 'specialDexSupportsInsertFromAmount=false',
        route: executor01SimpleSellRoute,
        params: executor01SimpleSellParams,
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].specialDexFlag = SpecialDex.SWAP_ON_BALANCER_V1;
          params[0].specialDexSupportsInsertFromAmount = false;
        },
      },
    ]) {
      const { route, params } = buildCase(
        testCase.route,
        testCase.params,
        testCase.mutate,
      );
      cases[testCase.name] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor02 reference bytecode for return/insert overrides', () => {
    const builder = new Executor02BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    for (const testCase of [
      {
        name: 'returnAmountPos=0',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].returnAmountPos = 0;
        },
      },
      {
        name: 'returnAmountPos=7',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].returnAmountPos = 7;
        },
      },
      {
        name: 'insertFromAmountPos=68',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 68;
        },
      },
      {
        name: 'insertFromAmountPos=65535',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 65535;
        },
      },
      {
        name: 'insertFromAmountPos ignored when flag does not insert',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 68;
          params[0].swappedAmountNotPresentInExchangeData = true;
        },
      },
    ]) {
      const { route, params } = buildCase(
        executor02VerticalRoute,
        executor02VerticalParams,
        testCase.mutate,
      );
      cases[testCase.name] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    const rootUnwrapFallback = buildCase(
      executor02NativeDestRoute,
      executor02NativeDestParams,
      params => {
        params.forEach(param => {
          param.returnAmountPos = 7;
        });
      },
    );
    cases['returnAmountPos ignored for root unwrap fallback'] =
      builder.buildByteCode(
        buildExecutorSnapshotInput(
          rootUnwrapFallback.route,
          rootUnwrapFallback.params,
          NULL_ADDRESS,
          executor02NativeDestWethPlan,
        ),
      );

    expect(cases).toMatchSnapshot();
  });

  it('records Executor03 reference bytecode for insert and packed-128 overrides', () => {
    const builder = new Executor03BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    for (const testCase of [
      {
        name: 'insertFromAmountPos=68',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 68;
        },
      },
      {
        name: 'insertFromAmountPos=65535',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 65535;
        },
      },
      {
        name: 'insertFromAmountPos ignored when flag does not insert',
        mutate: (params: DexExchangeBuildParam[]) => {
          params[0].insertFromAmountPos = 68;
          params[0].swappedAmountNotPresentInExchangeData = true;
        },
      },
      {
        name: 'amountsPacked128 positive',
        mutate: (params: DexExchangeBuildParam[], route: OptimalRate) => {
          withPackedInt128Amounts(params, route, false);
        },
      },
      {
        name: 'amountsPacked128 negative',
        mutate: (params: DexExchangeBuildParam[], route: OptimalRate) => {
          withPackedInt128Amounts(params, route, true);
        },
      },
      {
        name: 'uint256 negative fallback',
        mutate: (params: DexExchangeBuildParam[], route: OptimalRate) => {
          const swapExchange = route.bestRoute[0].swaps[0].swapExchanges[0];
          params[0].exchangeData = hexConcat([
            '0x12345678',
            defaultAbiCoder.encode(
              ['int256'],
              [BigNumber.from(swapExchange.srcAmount).mul(-1)],
            ),
            defaultAbiCoder.encode(
              ['int256'],
              [BigNumber.from(swapExchange.destAmount).mul(-1)],
            ),
          ]);
        },
      },
    ]) {
      const { route, params } = buildCase(
        buildExecutor03BuyRoute(),
        executor01SimpleSellParams,
        testCase.mutate,
      );
      cases[testCase.name] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records emitted specialDexFlag inventory reference bytecode', () => {
    const builder = new Executor01BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    for (const flag of emittedSpecialDexFlags) {
      const { route, params } = buildCase(
        executor01SimpleSellRoute,
        executor01SimpleSellParams,
        params => {
          params[0].specialDexFlag = flag;
          params[0].specialDexSupportsInsertFromAmount = true;
        },
      );
      cases[`Executor01 ${SpecialDex[flag]}=${flag}`] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor02 normal approval reference bytecode', () => {
    const builder = new Executor02BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      withApproval(params[0], route.srcToken);
      cases['erc20 max approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      withApproval(params[0], route.srcToken);
      params[0].permit2Approval = true;
      cases['permit2 approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const { route, params } = oneExchangeRoute(
        executor02VerticalRoute,
        executor02VerticalParams,
      );
      withSourceToken(route, USDT_ADDRESS);
      withApproval(params[0], USDT_ADDRESS);
      cases['disabled max-unit reset approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor03 normal approval reference bytecode', () => {
    const builder = new Executor03BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      withApproval(params[0], route.srcToken);
      cases['erc20 max approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      withApproval(params[0], route.srcToken);
      params[0].permit2Approval = true;
      cases['permit2 approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      withSourceToken(route, USDT_ADDRESS);
      withApproval(params[0], USDT_ADDRESS);
      cases['disabled max-unit reset approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor02 WETH approval and transfer-before-swap reference bytecode', () => {
    const builder = new Executor02BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeSrcRoute,
        executor02NativeSrcParams,
      );
      withApproval(params[0], context.wrappedNativeTokenAddress);
      cases['weth deposit approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(
          route,
          params,
          NULL_ADDRESS,
          executor02NativeSrcWethPlan,
        ),
      );
    }

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      params[0].transferSrcTokenBeforeSwap = TRANSFER_TARGET;
      withApproval(params[0], route.srcToken);
      cases['single-swap transfer before swap'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const { route, params } = twoExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      params[1].transferSrcTokenBeforeSwap = TRANSFER_TARGET;
      withApproval(params[1], route.srcToken);
      cases['split-swap transfer before swap'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const route = clone(executor02MultiSwapRoute) as unknown as OptimalRate;
      const params = asDexExchangeBuildParams(clone(executor02MultiSwapParams));
      params[1].transferSrcTokenBeforeSwap = TRANSFER_TARGET;
      withApproval(params[1], route.bestRoute[0].swaps[1].srcToken);
      cases['sequential multiswap transfer before swap'] =
        builder.buildByteCode(
          buildExecutorSnapshotInput(
            route,
            params,
            NULL_ADDRESS,
            executor02MultiSwapWethPlan,
          ),
        );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor03 WETH approval and transfer-before-swap reference bytecode', () => {
    const builder = new Executor03BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    {
      const route = clone(executor01WethDepositRoute) as unknown as OptimalRate;
      route.side = SwapSide.BUY;
      route.contractMethod = 'swapExactAmountOut';
      const params = asDexExchangeBuildParams(
        clone(executor01WethDepositParams),
      );
      withApproval(params[0], context.wrappedNativeTokenAddress);
      cases['weth deposit approval'] = builder.buildByteCode(
        buildExecutorSnapshotInput(
          route,
          params,
          NULL_ADDRESS,
          executor01WethDepositPlan,
        ),
      );
    }

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      params[0].transferSrcTokenBeforeSwap = TRANSFER_TARGET;
      withApproval(params[0], route.srcToken);
      cases['single-swap transfer before swap'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      route.bestRoute[0].swaps[0].swapExchanges.push({
        ...clone(route.bestRoute[0].swaps[0].swapExchanges[0]),
        srcAmount: '2000000',
        destAmount: '3000000',
        percent: 40,
      });
      route.bestRoute[0].swaps[0].swapExchanges[0].percent = 60;
      params.push({
        ...clone(params[0]),
        exchangeData: hexConcat([
          '0x87654321',
          defaultAbiCoder.encode(['uint256'], ['2000000']),
          defaultAbiCoder.encode(['uint256'], ['3000000']),
        ]),
        transferSrcTokenBeforeSwap: TRANSFER_TARGET,
      });
      withApproval(params[1], route.srcToken);
      cases['split-swap transfer before swap'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor02 unwrap and custom-WETH reference bytecode', () => {
    const builder = new Executor02BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      withSourceToken(route, context.wrappedNativeTokenAddress);
      params[0].needUnwrapNative = true;
      cases['weth source unwrap before dex call'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      withDestToken(route, context.wrappedNativeTokenAddress);
      params[0].needUnwrapNative = true;
      cases['weth destination wrap after dex call'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const { route, params } = twoExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      params[0].needWrapNative = true;
      params[1].needWrapNative = false;
      cases['mixed needWrapNative last-swap unwrap'] = builder.buildByteCode(
        buildExecutorSnapshotInput(
          route,
          params,
          NULL_ADDRESS,
          executor02NativeDestWethPlan,
        ),
      );
    }

    {
      const { route, params } = oneExchangeRoute(
        executor02NativeDestRoute,
        executor02NativeDestParams,
      );
      params[0].wethAddress = CUSTOM_WETH_ADDRESS;
      cases['custom wethAddress'] = builder.buildByteCode(
        buildExecutorSnapshotInput(
          route,
          params,
          NULL_ADDRESS,
          executor02NativeDestWethPlan,
        ),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records Executor03 unwrap and custom-WETH reference bytecode', () => {
    const builder = new Executor03BytecodeBuilder(context);
    const cases: Record<string, string> = {};

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      withSourceToken(route, context.wrappedNativeTokenAddress);
      params[0].needUnwrapNative = true;
      cases['weth source unwrap before dex call'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      withDestToken(route, context.wrappedNativeTokenAddress);
      params[0].needUnwrapNative = true;
      cases['weth destination wrap after dex call'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    {
      const route = buildExecutor03BuyRoute();
      const params = asDexExchangeBuildParams(
        clone(executor01SimpleSellParams),
      );
      params[0].wethAddress = CUSTOM_WETH_ADDRESS;
      cases['custom wethAddress'] = builder.buildByteCode(
        buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
      );
    }

    expect(cases).toMatchSnapshot();
  });

  it('records RA-6 downstream Tessera to Metric route reference bytecode', () => {
    const baseContext = createExecutorSnapshotContext(Network.BASE);
    const dexHelper = createDexBuilderHelper(Network.BASE) as any;
    const tessera = new Tessera(dexHelper);
    const metric = new Metric(dexHelper);
    const dateSpy = jest
      .spyOn(Date.prototype, 'getTime')
      .mockReturnValue(RA6_FAKE_NOW_MS);

    try {
      const route = clone(downstreamMetricRoute);
      const tesseraSwap = route.bestRoute[0].swaps[0];
      const tesseraSwapExchange = tesseraSwap.swapExchanges[0];
      const metricSwap = route.bestRoute[0].swaps[1];
      const metricSwapExchange = metricSwap.swapExchanges[0];

      const params = asDexExchangeBuildParams([
        tessera.getDexParam(
          tesseraSwap.srcToken,
          tesseraSwap.destToken,
          tesseraSwapExchange.srcAmount,
          tesseraSwapExchange.destAmount,
          NULL_ADDRESS,
          null,
          route.side,
        ),
        metric.getDexParam(
          metricSwap.srcToken,
          metricSwap.destToken,
          metricSwapExchange.srcAmount,
          metricSwapExchange.destAmount,
          NULL_ADDRESS,
          metricSwapExchange.data,
          route.side,
        ),
      ]);

      expect(params[1].returnAmountPos).toBe(0);
      expect(
        new Executor01BytecodeBuilder(baseContext).buildByteCode(
          buildExecutorSnapshotInput(route, params, NULL_ADDRESS),
        ),
      ).toMatchSnapshot();
    } finally {
      dateSpy.mockRestore();
    }
  });
});
