import type { IDexHelper } from '../dex-helper';
import { ConfigHelper } from '../config';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../constants';
import type { Address, Config, DexExchangeBuildParam } from '../types';
import { getApprovalTokenAndTarget } from './approval';
import {
  createExecutorEncodingContextFromDexHelper,
  createNoopExecutorEncodingLogger,
} from './encoding-context';
import type { ResolvedLeg, RoutePlan, RoutePosition } from './encoding-types';
import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { getOrderedExecutorLegs, routePositionKey } from './route-plan';
import { Executors } from './types';

const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_C = '0xcccccccccccccccccccccccccccccccccccccccc';
const TARGET_EXCHANGE = '0xdddddddddddddddddddddddddddddddddddddddd';
const SPENDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TRANSFER_TARGET = '0xffffffffffffffffffffffffffffffffffffffff';
const CUSTOM_WETH_ADDRESS = '0x1111111111111111111111111111111111111111';

describe('executor encoding helpers', () => {
  describe('getOrderedExecutorLegs', () => {
    it('preserves route-plan walk order while matching resolved legs by route position', () => {
      const routePlan = buildRoutePlanFixture();
      const firstLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });
      const secondLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 1,
      });
      const thirdLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 1,
        swapExchangeIndex: 0,
      });

      const orderedLegs = getOrderedExecutorLegs(routePlan, [
        thirdLeg,
        firstLeg,
        secondLeg,
      ]);

      expect(orderedLegs.map(routePositionKey)).toEqual([
        '0:0:0',
        '0:0:1',
        '0:1:0',
      ]);
      expect(orderedLegs.map(({ resolvedLeg }) => resolvedLeg)).toEqual([
        firstLeg,
        secondLeg,
        thirdLeg,
      ]);
      expect(
        orderedLegs.map(({ swapExchange }) => swapExchange.exchange),
      ).toEqual(['UniswapV3', 'SushiSwapV3', 'CurveV1']);
    });

    it('throws when a route-plan position has no resolved leg', () => {
      const routePlan = buildRoutePlanFixture();
      const firstLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });
      const secondLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 1,
      });

      expect(() =>
        getOrderedExecutorLegs(routePlan, [firstLeg, secondLeg]),
      ).toThrow('missing resolved leg for route position 0:1:0');
    });

    it('throws when resolved legs contain duplicate route positions', () => {
      const routePlan = buildSingleLegRoutePlanFixture();
      const resolvedLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });
      const duplicateResolvedLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });

      expect(() =>
        getOrderedExecutorLegs(routePlan, [resolvedLeg, duplicateResolvedLeg]),
      ).toThrow('duplicate resolved leg route position(s): 0:0:0');
    });

    it('throws when resolved legs contain positions outside the route plan', () => {
      const routePlan = buildSingleLegRoutePlanFixture();
      const resolvedLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });
      const extraResolvedLeg = buildResolvedLeg({
        routeIndex: 1,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });

      expect(() =>
        getOrderedExecutorLegs(routePlan, [resolvedLeg, extraResolvedLeg]),
      ).toThrow(
        'resolved leg route position(s) not present in route plan: 1:0:0',
      );
    });

    it('handles single-leg route plans', () => {
      const routePlan = buildSingleLegRoutePlanFixture();
      const resolvedLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });

      expect(getOrderedExecutorLegs(routePlan, [resolvedLeg])).toEqual([
        {
          ...routePositionAt(0, 0, 0),
          route: routePlan.routes[0],
          swap: routePlan.routes[0].swaps[0],
          swapExchange: routePlan.routes[0].swaps[0].swapExchanges[0],
          resolvedLeg,
        },
      ]);
    });

    it('preserves order across mega routes', () => {
      const routePlan = buildMegaRoutePlanFixture();
      const firstLeg = buildResolvedLeg({
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });
      const secondLeg = buildResolvedLeg({
        routeIndex: 1,
        swapIndex: 0,
        swapExchangeIndex: 0,
      });

      const orderedLegs = getOrderedExecutorLegs(routePlan, [
        secondLeg,
        firstLeg,
      ]);

      expect(orderedLegs.map(routePositionKey)).toEqual(['0:0:0', '1:0:0']);
      expect(orderedLegs.map(({ resolvedLeg }) => resolvedLeg)).toEqual([
        firstLeg,
        secondLeg,
      ]);
    });

    it('returns no ordered legs for an empty route plan', () => {
      expect(getOrderedExecutorLegs({ routes: [] }, [])).toEqual([]);
    });
  });

  describe('createExecutorEncodingContextFromDexHelper', () => {
    it('normalizes addresses, synthesizes WETH executor address, and wires logger', () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const getLogger = jest.fn(
        () => logger as unknown as ReturnType<IDexHelper['getLogger']>,
      );
      const dexHelper = createMixedCaseDexHelper(
        getLogger as unknown as IDexHelper['getLogger'],
      );

      const context = createExecutorEncodingContextFromDexHelper(dexHelper);

      expect(context.network).toBe(Network.MAINNET);
      expect(context.augustusV6Address).toBe(
        MIXED_AUGUSTUS_V6_ADDRESS.toLowerCase(),
      );
      expect(context.wrappedNativeTokenAddress).toBe(
        MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS.toLowerCase(),
      );
      expect(context.executorsAddresses).toEqual({
        [Executors.ONE]: MIXED_EXECUTOR_ONE_ADDRESS.toLowerCase(),
        [Executors.TWO]: MIXED_EXECUTOR_TWO_ADDRESS.toLowerCase(),
        [Executors.THREE]: MIXED_EXECUTOR_THREE_ADDRESS.toLowerCase(),
        [Executors.WETH]: MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS.toLowerCase(),
      });
      expect(
        context.isWETH(MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS.toUpperCase()),
      ).toBe(true);
      expect(context.isWETH(MIXED_EXECUTOR_ONE_ADDRESS)).toBe(false);

      context.logger.warn('executor warning');

      expect(getLogger).toHaveBeenCalledWith('ExecutorBytecodeBuilder');
      expect(logger.warn).toHaveBeenCalledWith('executor warning');
    });

    it.each(['augustusV6Address', 'wrappedNativeTokenAddress'] as const)(
      'throws a clear error when %s is missing',
      fieldName => {
        const dexHelper = createMixedCaseDexHelper();
        (
          dexHelper.config.data as unknown as Record<
            typeof fieldName,
            Address | undefined
          >
        )[fieldName] = undefined;

        expect(() =>
          createExecutorEncodingContextFromDexHelper(dexHelper),
        ).toThrow(`${fieldName} is required`);
      },
    );

    it('accepts a configured WETH executor address that matches wrapped native token', () => {
      const dexHelper = createMixedCaseDexHelper();
      dexHelper.config.data.executorsAddresses![Executors.WETH] =
        MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS.toUpperCase();

      const context = createExecutorEncodingContextFromDexHelper(dexHelper);

      expect(context.executorsAddresses[Executors.WETH]).toBe(
        MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS.toLowerCase(),
      );
    });

    it('rejects a configured WETH executor address that differs from wrapped native token', () => {
      const dexHelper = createMixedCaseDexHelper();
      dexHelper.config.data.executorsAddresses![Executors.WETH] =
        MIXED_EXECUTOR_ONE_ADDRESS;

      expect(() =>
        createExecutorEncodingContextFromDexHelper(dexHelper),
      ).toThrow(
        `executorsAddresses.${Executors.WETH} must match wrappedNativeTokenAddress`,
      );
    });
  });

  describe('createNoopExecutorEncodingLogger', () => {
    it('provides every logger method used by the encoding context', () => {
      const logger = createNoopExecutorEncodingLogger();

      expect(() => {
        logger.debug('debug');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');
      }).not.toThrow();
    });
  });

  describe('getApprovalTokenAndTarget', () => {
    it('matches the current executor builder approval behavior', () => {
      const dexHelper = createMixedCaseDexHelper();
      const context = createExecutorEncodingContextFromDexHelper(dexHelper);
      const builder = new Executor01BytecodeBuilder(dexHelper);

      const cases: ApprovalCase[] = [
        {
          name: 'default non-ETH source',
          srcToken: TOKEN_A,
          exchangeParam: {},
        },
        {
          name: 'skip approval',
          srcToken: TOKEN_A,
          exchangeParam: { skipApproval: true },
        },
        {
          name: 'skip approval short-circuits wrap logic',
          srcToken: ETHER_ADDRESS,
          exchangeParam: { skipApproval: true, needWrapNative: true },
        },
        {
          name: 'WETH source unwrapped before DEX call',
          srcToken: context.wrappedNativeTokenAddress,
          exchangeParam: { needUnwrapNative: true },
        },
        {
          name: 'non-WETH source with unwrap flag falls through',
          srcToken: TOKEN_A,
          exchangeParam: { needUnwrapNative: true },
        },
        {
          name: 'ETH source wrapped before DEX call',
          srcToken: ETHER_ADDRESS,
          exchangeParam: { needWrapNative: true },
        },
        {
          name: 'ETH source wrapped with custom WETH address',
          srcToken: ETHER_ADDRESS,
          exchangeParam: {
            needWrapNative: true,
            wethAddress: CUSTOM_WETH_ADDRESS,
          },
        },
        {
          name: 'ETH source wrapped with transfer before swap',
          srcToken: ETHER_ADDRESS,
          exchangeParam: {
            needWrapNative: true,
            transferSrcTokenBeforeSwap: TRANSFER_TARGET,
          },
        },
        {
          name: 'source token transferred before swap',
          srcToken: TOKEN_A,
          exchangeParam: { transferSrcTokenBeforeSwap: TRANSFER_TARGET },
        },
        {
          name: 'custom spender',
          srcToken: TOKEN_A,
          exchangeParam: { spender: SPENDER },
        },
      ];

      cases.forEach(({ name, srcToken, exchangeParam }) => {
        const swap = { srcToken } as Parameters<
          Executor01BytecodeBuilder['getApprovalTokenAndTarget']
        >[0];
        const buildParam = buildExchangeParam(exchangeParam);
        const result = getApprovalTokenAndTarget(swap, buildParam, context);
        const expected = builder.getApprovalTokenAndTarget(swap, buildParam);

        expect({ name, result }).toEqual({ name, result: expected });
      });
    });
  });
});

const MIXED_AUGUSTUS_V6_ADDRESS = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';
const MIXED_EXECUTOR_ONE_ADDRESS = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';
const MIXED_EXECUTOR_TWO_ADDRESS = '0xDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd';
const MIXED_EXECUTOR_THREE_ADDRESS =
  '0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe';

type ApprovalCase = {
  name: string;
  srcToken: Address;
  exchangeParam: ExchangeParamOverrides;
};

type ExchangeParamOverrides = Partial<
  Omit<DexExchangeBuildParam, 'needWrapNative'>
> & {
  needWrapNative?: boolean;
};

function buildRoutePlanFixture(): RoutePlan {
  return {
    routes: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: TOKEN_A,
            destToken: TOKEN_B,
            srcAmount: '100',
            destAmount: '90',
            swapExchanges: [
              {
                exchange: 'UniswapV3',
                percent: 60,
                srcAmount: '60',
                destAmount: '54',
              },
              {
                exchange: 'SushiSwapV3',
                percent: 40,
                srcAmount: '40',
                destAmount: '36',
              },
            ],
          },
          {
            srcToken: TOKEN_B,
            destToken: TOKEN_C,
            srcAmount: '90',
            destAmount: '80',
            swapExchanges: [
              {
                exchange: 'CurveV1',
                percent: 100,
                srcAmount: '90',
                destAmount: '80',
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildSingleLegRoutePlanFixture(): RoutePlan {
  return {
    routes: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: TOKEN_A,
            destToken: TOKEN_B,
            srcAmount: '100',
            destAmount: '90',
            swapExchanges: [
              {
                exchange: 'UniswapV3',
                percent: 100,
                srcAmount: '100',
                destAmount: '90',
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildMegaRoutePlanFixture(): RoutePlan {
  return {
    routes: [
      {
        percent: 60,
        swaps: [
          {
            srcToken: TOKEN_A,
            destToken: TOKEN_B,
            srcAmount: '60',
            destAmount: '54',
            swapExchanges: [
              {
                exchange: 'UniswapV3',
                percent: 100,
                srcAmount: '60',
                destAmount: '54',
              },
            ],
          },
        ],
      },
      {
        percent: 40,
        swaps: [
          {
            srcToken: TOKEN_A,
            destToken: TOKEN_C,
            srcAmount: '40',
            destAmount: '36',
            swapExchanges: [
              {
                exchange: 'CurveV1',
                percent: 100,
                srcAmount: '40',
                destAmount: '36',
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildResolvedLeg(position: RoutePosition): ResolvedLeg {
  return {
    ...position,
    exchangeParam: buildExchangeParam({}),
    normalizedSrcToken: TOKEN_A,
    normalizedDestToken: TOKEN_B,
    normalizedSrcAmount: '1',
    normalizedDestAmount: '1',
    recipient: TARGET_EXCHANGE,
  };
}

function routePositionAt(
  routeIndex: number,
  swapIndex: number,
  swapExchangeIndex: number,
): RoutePosition {
  return {
    routeIndex,
    swapIndex,
    swapExchangeIndex,
  };
}

function buildExchangeParam(
  overrides: ExchangeParamOverrides,
): DexExchangeBuildParam {
  return {
    needWrapNative: false,
    exchangeData: '0x',
    targetExchange: TARGET_EXCHANGE,
    dexFuncHasRecipient: true,
    ...overrides,
  };
}

// Hand-built mixed-case config keeps this unit test independent from
// environment-backed generateConfig() and verifies normalization directly.
function createMixedCaseDexHelper(
  getLogger: IDexHelper['getLogger'] = createNoopDexHelperLogger,
): IDexHelper {
  const config: Config = {
    network: Network.MAINNET,
    networkName: 'Ethereum Mainnet',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenName: 'Wrapped Ether',
    wrappedNativeTokenSymbol: 'WETH',
    wrappedNativeTokenAddress: MIXED_WRAPPED_NATIVE_TOKEN_ADDRESS,
    hasEIP1559: true,
    augustusAddress: NULL_ADDRESS,
    augustusV6Address: MIXED_AUGUSTUS_V6_ADDRESS,
    augustusRFQAddress: NULL_ADDRESS,
    tokenTransferProxyAddress: NULL_ADDRESS,
    multicallV2Address: NULL_ADDRESS,
    privateHttpProvider: 'http://localhost',
    adapterAddresses: {},
    executorsAddresses: {
      [Executors.ONE]: MIXED_EXECUTOR_ONE_ADDRESS,
      [Executors.TWO]: MIXED_EXECUTOR_TWO_ADDRESS,
      [Executors.THREE]: MIXED_EXECUTOR_THREE_ADDRESS,
    },
    uniswapV2ExchangeRouterAddress: NULL_ADDRESS,
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 0,
    rpcPollingBlocksBackToTriggerUpdate: 0,
    hashFlowDisabledMMs: [],
    forceRpcFallbackDexs: [],
    apiKeyTheGraph: '',
  };

  return {
    config: new ConfigHelper(false, config, 'executor-encoding-tests'),
    getLogger,
  } as unknown as IDexHelper;
}

function createNoopDexHelperLogger(): ReturnType<IDexHelper['getLogger']> {
  return createNoopExecutorEncodingLogger() as unknown as ReturnType<
    IDexHelper['getLogger']
  >;
}
