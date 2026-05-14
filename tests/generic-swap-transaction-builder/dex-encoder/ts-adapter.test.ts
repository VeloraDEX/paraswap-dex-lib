import { ContractMethodV6, SwapSide } from '@paraswap/core';
import { BalancerV1 } from '../../../src/dex/balancer-v1/balancer-v1';
import { BalancerV2 } from '../../../src/dex/balancer-v2/balancer-v2';
import { BalancerPoolTypes } from '../../../src/dex/balancer-v2/types';
import { CurveV1 } from '../../../src/dex/curve-v1/curve-v1';
import { CurveV2 } from '../../../src/dex/curve-v2/curve-v2';
import { GenericRFQ } from '../../../src/dex/generic-rfq/generic-rfq';
import { LitePsm } from '../../../src/dex/lite-psm/lite-psm';
import { UniswapV2 } from '../../../src/dex/uniswap-v2/uniswap-v2';
import { UniswapV3 } from '../../../src/dex/uniswap-v3/uniswap-v3';
import { Weth } from '../../../src/dex/weth/weth';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../../src/constants';
import type { IDexTxBuilder, NeedWrapNativeFunc } from '../../../src/dex/idex';
import type { ExecutorEncodingContext } from '../../../src/executor/encoding-types';
import { Executors } from '../../../src/executor/types';
import {
  createTsDexEncoderRegistry,
  createWethCallDataProvider,
  type DexEncoderRegistryPort,
  type DexParamInput,
  type DirectParamInput,
  type NeedWrapNativeInput,
} from '../../../src/generic-swap-transaction-builder/dex-encoder';
import type { Address } from '../../../src/types';
import type {
  DexEncoderFixture,
  DexParamFixture,
  DirectParamFixture,
  NeedWrapNativeFixture,
} from './dex-encoder-fixture-schema';
import { loadDexEncoderFixtures } from './dex-encoder-fixture-loader';

const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TARGET_EXCHANGE = '0xcccccccccccccccccccccccccccccccccccccccc';
const EXECUTOR_ADDRESS = '0xdddddddddddddddddddddddddddddddddddddddd';
const AUGUSTUS_ADDRESS = '0xdef171fe48cf0115b1d80b88dc8eab59176fee57';
const AUGUSTUS_V6_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';
const WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const POOL_ADDRESS = '0x4444444444444444444444444444444444444444';
const BALANCER_POOL_ID = `0x${'44'.repeat(32)}`;

type TestDex = Partial<IDexTxBuilder<unknown, unknown>> & {
  getDirectFunctionNameV6?: () => string[];
};

describe('TS DEX encoder adapter', () => {
  const loadedFixtures = loadDexEncoderFixtures().map(({ fixture }) => fixture);

  it('replays Phase 3 conformance fixtures through real TS builders', async () => {
    const registry = createRealBuilderRegistry();

    for (const fixture of loadedFixtures) {
      if (fixture.kind === 'need-wrap-native') {
        const encoder = await registry.getDexEncoder({
          network: fixture.network,
          dexKey: fixture.dexKey,
        });

        await expect(encoder.needWrapNative(fixture.input)).resolves.toBe(
          fixture.expected,
        );
      } else if (fixture.kind === 'dex-param') {
        const encoder = await registry.getDexEncoder({
          network: fixture.network,
          dexKey: fixture.dexKey,
        });

        await expect(
          withFixedDate(() => encoder.getDexParam(fixture.input)),
        ).resolves.toEqual(fixture.expected);
      } else {
        const encoder = await registry.getDirectDexEncoder({
          network: fixture.network,
          dexKey: fixture.dexKey,
          contractMethod: fixture.contractMethod,
        });

        await expect(
          withFixedDate(() => encoder.getDirectParam(fixture.input)),
        ).resolves.toEqual(fixture.expected);
      }
    }
  });

  it('replays fixture-shaped outputs through the adapter surface', async () => {
    for (const fixture of loadedFixtures) {
      const registry = createFixtureRegistry(fixture);

      if (fixture.kind === 'need-wrap-native') {
        const encoder = await registry.getDexEncoder({
          network: fixture.network,
          dexKey: fixture.dexKey,
        });

        await expect(encoder.needWrapNative(fixture.input)).resolves.toBe(
          fixture.expected,
        );
      } else if (fixture.kind === 'dex-param') {
        const encoder = await registry.getDexEncoder({
          network: fixture.network,
          dexKey: fixture.dexKey,
        });

        await expect(encoder.getDexParam(fixture.input)).resolves.toEqual(
          fixture.expected,
        );
      } else {
        const encoder = await registry.getDirectDexEncoder({
          network: fixture.network,
          dexKey: fixture.dexKey,
          contractMethod: fixture.contractMethod,
        });

        await expect(encoder.getDirectParam(fixture.input)).resolves.toEqual(
          fixture.expected,
        );
      }
    }
  });

  it('adapts static and function-typed needWrapNative values', async () => {
    const input = buildNeedWrapNativeInput();
    const functionNeedWrapNative: NeedWrapNativeFunc = (
      priceRoute,
      swap,
      swapExchange,
    ) => {
      expect(priceRoute.network).toBe(input.route.network);
      expect(priceRoute.side).toBe(input.route.side);
      expect(swap.srcToken).toBe(input.swap.srcToken);
      expect(swapExchange.data).toEqual(input.swapExchange.data);
      return true;
    };
    const registry = createRegistry({
      StaticDex: { needWrapNative: false },
      FunctionDex: { needWrapNative: functionNeedWrapNative },
    });

    await expect(
      (
        await registry.getDexEncoder({
          network: Network.MAINNET,
          dexKey: 'StaticDex',
        })
      ).needWrapNative(input),
    ).resolves.toBe(false);
    await expect(
      (
        await registry.getDexEncoder({
          network: Network.MAINNET,
          dexKey: 'FunctionDex',
        })
      ).needWrapNative(input),
    ).resolves.toBe(true);
  });

  it.each([
    {
      label: 'sync',
      getDexParam: (input: DexParamInput) => buildLegacyDexParam(input),
    },
    {
      label: 'async',
      getDexParam: async (input: DexParamInput) => buildLegacyDexParam(input),
    },
  ])('normalizes and validates $label getDexParam output', async testCase => {
    const input = buildDexParamInput();
    const registry = createRegistry({
      TestDex: {
        needWrapNative: false,
        getDexParam: (
          srcToken: string,
          destToken: string,
          srcAmount: string,
          destAmount: string,
          recipient: string,
          data: unknown,
          side: SwapSide,
          executorAddress: string,
        ) => {
          expect([
            srcToken,
            destToken,
            srcAmount,
            destAmount,
            recipient,
            data,
            side,
            executorAddress,
          ]).toEqual([
            input.srcToken,
            input.destToken,
            input.srcAmount,
            input.destAmount,
            input.recipient,
            input.data,
            input.side,
            input.executorAddress,
          ]);

          return testCase.getDexParam(input);
        },
      },
    });
    const encoder = await registry.getDexEncoder({
      network: Network.MAINNET,
      dexKey: 'TestDex',
    });

    await expect(encoder.getDexParam(input)).resolves.toEqual({
      needWrapNative: true,
      needUnwrapNative: false,
      exchangeData: '0xabcd',
      targetExchange: TARGET_EXCHANGE,
      dexFuncHasRecipient: true,
      spender: EXECUTOR_ADDRESS,
      returnAmountPos: 64,
    });
  });

  it('rejects missing DEX methods and unsupported direct method pairs', async () => {
    const registry = createRegistry({
      NoGenericMethod: { needWrapNative: false },
      DirectDex: {
        needWrapNative: false,
        getDirectFunctionNameV6: () => [
          ContractMethodV6.swapExactAmountInOnUniswapV2,
        ],
        getDirectParamV6: () => ({
          params: [],
          encoder: () => '0x',
          networkFee: '0',
        }),
      },
    });

    const genericEncoder = await registry.getDexEncoder({
      network: Network.MAINNET,
      dexKey: 'NoGenericMethod',
    });

    await expect(
      genericEncoder.getDexParam(buildDexParamInput()),
    ).rejects.toThrow(
      'Invalid DEX: dex should have getDexParam: NoGenericMethod',
    );
    await expect(
      registry.getDirectDexEncoder({
        network: Network.MAINNET,
        dexKey: 'DirectDex',
        contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV3,
      }),
    ).rejects.toThrow(
      'Invalid DEX: DirectDex does not support direct method swapExactAmountInOnUniswapV3',
    );
  });

  it('strips direct encoder callbacks and contract-method metadata', async () => {
    const input = buildDirectParamInput();
    const registry = createRegistry({
      DirectDex: {
        needWrapNative: false,
        getDirectFunctionNameV6: () => [input.contractMethod],
        getDirectParamV6: () => ({
          params: ['param'],
          encoder: () => '0xdead',
          networkFee: '0',
          contractMethod: 'unexpected',
        }),
      },
    });
    const encoder = await registry.getDirectDexEncoder({
      network: Network.MAINNET,
      dexKey: 'DirectDex',
      contractMethod: input.contractMethod,
    });

    await expect(encoder.getDirectParam(input)).resolves.toEqual({
      params: ['param'],
    });
  });

  it('rejects non-JSON direct params with a DEX-specific error', async () => {
    const input = buildDirectParamInput();
    const registry = createRegistry({
      DirectDex: {
        needWrapNative: false,
        getDirectFunctionNameV6: () => [input.contractMethod],
        getDirectParamV6: () => ({
          params: ['param', { invalid: BigInt(1) }],
          encoder: () => '0xdead',
          networkFee: '0',
        }),
      },
    });
    const encoder = await registry.getDirectDexEncoder({
      network: Network.MAINNET,
      dexKey: 'DirectDex',
      contractMethod: input.contractMethod,
    });

    await expect(encoder.getDirectParam(input)).rejects.toThrow(
      'Invalid DEX: DirectDex.params[1].invalid must be JSON-serializable; received bigint',
    );
  });

  it('uses NULL withdraw callee for V6 WETH deposit and withdraw calldata', async () => {
    const provider = createWethCallDataProvider(buildEncodingContext());
    const cases = [
      { srcAmountWeth: '10', destAmountWeth: '3', side: SwapSide.SELL },
      { srcAmountWeth: '10', destAmountWeth: '0', side: SwapSide.BUY },
      { srcAmountWeth: '0', destAmountWeth: '3', side: SwapSide.SELL },
    ];

    for (const testCase of cases) {
      const result = await provider.getDepositWithdrawCallData(testCase);
      if (result === undefined) {
        throw new Error('expected V6 WETH calldata');
      }

      if (testCase.srcAmountWeth === '0') {
        expect(result.deposit).toBeUndefined();
      } else {
        expect(result.deposit).toEqual({
          callee: WRAPPED_NATIVE_TOKEN_ADDRESS,
          calldata: '0xd0e30db0',
          value: testCase.srcAmountWeth,
        });
      }

      expect(result.withdraw).toEqual({
        callee: NULL_ADDRESS,
        calldata: expect.stringMatching(/^0x2e1a7d4d/),
        value: '0',
      });
    }
  });
});

function withFixedDate<T>(callback: () => T): T {
  const RealDate = Date;

  class FixedDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? 1_700_000_000_000);
    }

    static now(): number {
      return 1_700_000_000_000;
    }
  }

  global.Date = FixedDate as DateConstructor;

  try {
    return callback();
  } finally {
    global.Date = RealDate;
  }
}

function createRealBuilderRegistry(): DexEncoderRegistryPort {
  const dexHelper = buildRealBuilderDexHelper();
  const balancerV2 = new BalancerV2(Network.MAINNET, 'BalancerV2', dexHelper);
  seedBalancerV2FixturePool(balancerV2);

  const dexes: Record<string, IDexTxBuilder<unknown, unknown>> = {
    BalancerV1: new BalancerV1(Network.MAINNET, 'BalancerV1', dexHelper),
    BalancerV2: balancerV2,
    CurveV1: new CurveV1(Network.MAINNET, 'CurveV1', dexHelper),
    CurveV2: new CurveV2(dexHelper),
    GenericRFQ: new GenericRFQ(
      Network.MAINNET,
      'GenericRFQ',
      dexHelper,
      buildGenericRfqConfig(),
    ),
    LitePsm: new LitePsm(Network.MAINNET, 'LitePsm', dexHelper),
    SushiSwapV3: new UniswapV3(Network.MAINNET, 'SushiSwapV3', dexHelper),
    UniswapV2: new UniswapV2(Network.MAINNET, 'UniswapV2', dexHelper),
    UniswapV3: new UniswapV3(Network.MAINNET, 'UniswapV3', dexHelper),
    Weth: new Weth(Network.MAINNET, 'Weth', dexHelper),
  };

  return createTsDexEncoderRegistry({
    network: Network.MAINNET,
    getTxBuilderDexByKey: dexKey => {
      const dex = dexes[dexKey];
      if (!dex) throw new Error(`missing real test dex ${dexKey}`);
      return dex;
    },
  });
}

function seedBalancerV2FixturePool(balancerV2: BalancerV2): void {
  balancerV2.eventPools = {
    allPools: [buildBalancerFixturePool()],
  } as unknown as BalancerV2['eventPools'];
}

function buildBalancerFixturePool() {
  return {
    id: BALANCER_POOL_ID,
    address: POOL_ADDRESS,
    poolType: BalancerPoolTypes.Weighted,
    poolTypeVersion: 1,
    tokens: [
      { address: TOKEN_A, decimals: 18 },
      { address: TOKEN_B, decimals: 18 },
    ],
    tokensMap: {
      [TOKEN_A]: { address: TOKEN_A, decimals: 18 },
      [TOKEN_B]: { address: TOKEN_B, decimals: 18 },
    },
    mainIndex: 0,
    wrappedIndex: 1,
    mainTokens: [
      {
        address: TOKEN_A,
        decimals: 18,
        poolToken: { address: TOKEN_A, decimals: 18 },
        pathToToken: [],
        isDeeplyNested: false,
      },
      {
        address: TOKEN_B,
        decimals: 18,
        poolToken: { address: TOKEN_B, decimals: 18 },
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

function buildRealBuilderDexHelper(): any {
  class DummyContract {}

  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
  };
  const data = {
    network: Network.MAINNET,
    augustusAddress: AUGUSTUS_ADDRESS,
    augustusV6Address: AUGUSTUS_V6_ADDRESS,
    augustusRFQAddress: NULL_ADDRESS,
    wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
    uniswapV2ExchangeRouterAddress: POOL_ADDRESS,
    tokenTransferProxyAddress: NULL_ADDRESS,
    multicallV2Address: NULL_ADDRESS,
    adapterAddresses: {},
    executorsAddresses: {
      [Executors.ONE]: EXECUTOR_ADDRESS,
      [Executors.TWO]: EXECUTOR_ADDRESS,
      [Executors.THREE]: EXECUTOR_ADDRESS,
    },
    rfqConfigs: {},
    apiKeyTheGraph: '',
  };

  return {
    config: {
      isSlave: true,
      data,
      wrapETH: <T extends { address: Address }>(token: T): T => ({
        ...token,
        address:
          token.address.toLowerCase() === ETHER_ADDRESS
            ? WRAPPED_NATIVE_TOKEN_ADDRESS
            : token.address.toLowerCase(),
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
    getLogger: () => logger,
  };
}

function buildGenericRfqConfig(): any {
  const fetcherConfig = {
    reqParams: {
      url: 'http://localhost',
      method: 'GET',
    },
    secret: {
      domain: 'paraswap-test',
      accessKey: 'access',
      secretKey: 'secret',
    },
    intervalMs: 1,
    dataTTLS: 1,
  };

  return {
    tokensConfig: fetcherConfig,
    pairsConfig: fetcherConfig,
    rateConfig: fetcherConfig,
    firmRateConfig: fetcherConfig,
    maker: TOKEN_A,
    minTradeUsd: null,
  };
}

function createFixtureRegistry(
  fixture: DexEncoderFixture,
): DexEncoderRegistryPort {
  if (fixture.kind === 'need-wrap-native') {
    return createRegistry({
      [fixture.dexKey]: createNeedWrapNativeFixtureDex(fixture),
    });
  }

  if (fixture.kind === 'dex-param') {
    return createRegistry({
      [fixture.dexKey]: createDexParamFixtureDex(fixture),
    });
  }

  return createRegistry({
    [fixture.dexKey]: createDirectParamFixtureDex(fixture),
  });
}

function createNeedWrapNativeFixtureDex(
  fixture: NeedWrapNativeFixture,
): Partial<IDexTxBuilder<unknown, unknown>> {
  return {
    needWrapNative: ((priceRoute, swap, swapExchange): boolean => {
      expect(priceRoute.network).toBe(fixture.input.route.network);
      expect(priceRoute.side).toBe(fixture.input.route.side);
      expect(swap.srcToken).toBe(fixture.input.swap.srcToken);
      expect(swapExchange.data).toEqual(fixture.input.swapExchange.data);
      return fixture.expected;
    }) as NeedWrapNativeFunc,
  };
}

function createDexParamFixtureDex(
  fixture: DexParamFixture,
): Partial<IDexTxBuilder<unknown, unknown>> {
  return {
    needWrapNative: fixture.expected.needWrapNative,
    getDexParam: (
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      recipient,
      data,
      side,
      executorAddress,
    ) => {
      expect([
        srcToken,
        destToken,
        srcAmount,
        destAmount,
        recipient,
        data,
        side,
        executorAddress,
      ]).toEqual([
        fixture.input.srcToken,
        fixture.input.destToken,
        fixture.input.srcAmount,
        fixture.input.destAmount,
        fixture.input.recipient,
        fixture.input.data,
        fixture.input.side,
        fixture.input.executorAddress,
      ]);

      return clone(fixture.expected);
    },
  };
}

function createDirectParamFixtureDex(fixture: DirectParamFixture): Partial<
  IDexTxBuilder<unknown, unknown>
> & {
  getDirectFunctionNameV6: () => string[];
} {
  return {
    needWrapNative: false,
    getDirectFunctionNameV6: () => [fixture.contractMethod],
    getDirectParamV6: (
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      quotedAmount,
      data,
      side,
      permit,
      uuid,
      partnerAndFee,
      beneficiary,
      blockNumber,
      contractMethod,
    ) => {
      expect([
        srcToken,
        destToken,
        srcAmount,
        destAmount,
        quotedAmount,
        data,
        side,
        permit,
        uuid,
        partnerAndFee,
        beneficiary,
        blockNumber,
        contractMethod,
      ]).toEqual([
        fixture.input.srcToken,
        fixture.input.destToken,
        fixture.input.srcAmount,
        fixture.input.destAmount,
        fixture.input.quotedAmount,
        fixture.input.data,
        fixture.input.side,
        fixture.input.permit,
        fixture.input.uuid,
        fixture.input.partnerAndFee,
        fixture.input.beneficiary,
        fixture.input.blockNumber,
        fixture.input.contractMethod,
      ]);

      return {
        params: clone(fixture.expected.params),
        encoder: () => '0xdead',
        networkFee: '0',
      };
    },
  };
}

function createRegistry(
  dexes: Record<string, TestDex>,
): DexEncoderRegistryPort {
  return createTsDexEncoderRegistry({
    network: Network.MAINNET,
    getTxBuilderDexByKey: dexKey => {
      const dex = dexes[dexKey];
      if (!dex) throw new Error(`missing test dex ${dexKey}`);
      return dex as IDexTxBuilder<unknown, unknown>;
    },
  });
}

function buildLegacyDexParam(input: DexParamInput) {
  const needWrapNative: NeedWrapNativeFunc = (_priceRoute, swap) =>
    swap.srcToken === input.swap.srcToken;

  return {
    needWrapNative,
    needUnwrapNative: false,
    exchangeData: '0xABCD',
    targetExchange: uppercaseHexAddress(TARGET_EXCHANGE),
    dexFuncHasRecipient: true,
    spender: uppercaseHexAddress(EXECUTOR_ADDRESS),
    returnAmountPos: 64,
  };
}

function buildDexParamInput(): DexParamInput {
  return {
    ...buildNeedWrapNativeInput(),
    dexKey: 'TestDex',
    srcToken: TOKEN_A,
    destToken: TOKEN_B,
    srcAmount: '1000',
    destAmount: '900',
    recipient: AUGUSTUS_V6_ADDRESS,
    executorAddress: EXECUTOR_ADDRESS,
    side: SwapSide.SELL,
    data: { path: [{ tokenIn: TOKEN_A, tokenOut: TOKEN_B, fee: '500' }] },
  };
}

function buildNeedWrapNativeInput(): NeedWrapNativeInput {
  return {
    route: {
      network: Network.MAINNET,
      side: SwapSide.SELL,
      routeIndex: 0,
      routePercent: 100,
      blockNumber: 1,
      srcToken: TOKEN_A,
      destToken: TOKEN_B,
      srcAmount: '1000',
      destAmount: '900',
    },
    swap: {
      swapIndex: 0,
      srcToken: TOKEN_A,
      destToken: TOKEN_B,
      srcAmount: '1000',
      destAmount: '900',
    },
    swapExchange: {
      swapExchangeIndex: 0,
      exchange: 'TestDex',
      srcAmount: '1000',
      destAmount: '900',
      percent: 100,
      data: { path: [{ tokenIn: TOKEN_A, tokenOut: TOKEN_B, fee: '500' }] },
    },
  };
}

function buildDirectParamInput(): DirectParamInput {
  return {
    dexKey: 'DirectDex',
    network: Network.MAINNET,
    contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV2,
    srcToken: TOKEN_A,
    destToken: TOKEN_B,
    srcAmount: '1000',
    destAmount: '900',
    quotedAmount: '900',
    data: null,
    side: SwapSide.SELL,
    permit: '0x',
    uuid: '11111111-1111-1111-1111-111111111111',
    partnerAndFee: '0',
    beneficiary: AUGUSTUS_V6_ADDRESS,
    blockNumber: 1,
  };
}

function buildEncodingContext(): ExecutorEncodingContext {
  return {
    network: Network.MAINNET,
    augustusV6Address: AUGUSTUS_V6_ADDRESS,
    wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
    executorsAddresses: {
      [Executors.ONE]: EXECUTOR_ADDRESS,
      [Executors.TWO]: EXECUTOR_ADDRESS,
      [Executors.THREE]: EXECUTOR_ADDRESS,
      [Executors.WETH]: WRAPPED_NATIVE_TOKEN_ADDRESS,
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uppercaseHexAddress(address: string): string {
  return `0x${address.slice(2).toUpperCase()}`;
}
