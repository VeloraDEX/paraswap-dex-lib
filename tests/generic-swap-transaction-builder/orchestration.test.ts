import { ContractMethodV6, ParaSwapVersion, SwapSide } from '@paraswap/core';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../src/constants';
import { Executors } from '../../src/executor/types';
import type { ExecutorEncodingContext } from '../../src/executor/encoding-types';
import type {
  Address,
  DexExchangeBuildParam,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
} from '../../src/types';
import type {
  ResolvedLeg,
  RoutePlan,
} from '../../src/generic-swap-transaction-builder/resolved/types';
import { buildFeesV6 } from '../../src/generic-swap-transaction-builder/resolved';
import {
  applyDexExchangeApprovalDecisions,
  buildDexExchangeApprovalRequests,
  buildGenericDexCallParams,
  buildResolvedWethPlan,
  hasAnyRouteWithEthAndDifferentNeedWrapNative,
  resolveBeneficiary,
  resolvePermit,
  resolveQuotedAmount,
} from '../../src/generic-swap-transaction-builder/orchestration';

const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_C = '0xcccccccccccccccccccccccccccccccccccccccc';
const TARGET_EXCHANGE = '0xdddddddddddddddddddddddddddddddddddddddd';
const EXECUTOR_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const AUGUSTUS_V6_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff';
const WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0x4200000000000000000000000000000000000006';
const USER_ADDRESS = '0x1111111111111111111111111111111111111111';
const BENEFICIARY_ADDRESS = '0x2222222222222222222222222222222222222222';

describe('GenericSwapTransactionBuilder orchestration helpers', () => {
  describe('default resolution helpers', () => {
    it('defaults quoted amount from route side', () => {
      expect(
        resolveQuotedAmount(
          buildPriceRoute({ side: SwapSide.SELL, destAmount: '900' }),
        ),
      ).toBe('900');
      expect(
        resolveQuotedAmount(
          buildPriceRoute({ side: SwapSide.BUY, srcAmount: '1100' }),
        ),
      ).toBe('1100');
      expect(
        resolveQuotedAmount(
          buildPriceRoute({ side: SwapSide.SELL, destAmount: '900' }),
          '875',
        ),
      ).toBe('875');
    });

    it('normalizes default beneficiary semantics', () => {
      expect(resolveBeneficiary(USER_ADDRESS)).toBe(NULL_ADDRESS);
      expect(resolveBeneficiary(USER_ADDRESS, USER_ADDRESS.toUpperCase())).toBe(
        NULL_ADDRESS,
      );
      expect(resolveBeneficiary(USER_ADDRESS, BENEFICIARY_ADDRESS)).toBe(
        BENEFICIARY_ADDRESS,
      );
    });

    it('defaults empty permits to 0x', () => {
      expect(resolvePermit()).toBe('0x');
      expect(resolvePermit('')).toBe('0x');
      expect(resolvePermit('0x1234')).toBe('0x1234');
    });
  });

  describe('buildGenericDexCallParams', () => {
    it('keeps a simple final sell leg recipient on Augustus V6', () => {
      const swap = buildSwap({ srcToken: TOKEN_A, destToken: TOKEN_B });
      const priceRoute = buildPriceRoute({
        bestRoute: [{ percent: 100, swaps: [swap] }],
      });

      expect(
        buildGenericDexCallParams({
          priceRoute,
          routeIndex: 0,
          swap,
          swapIndex: 0,
          swapExchange: swap.swapExchanges[0],
          minMaxAmount: '900',
          dexNeedWrapNative: false,
          executionContractAddress: EXECUTOR_ADDRESS,
          wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
          augustusV6Address: AUGUSTUS_V6_ADDRESS,
        }),
      ).toEqual({
        srcToken: TOKEN_A,
        destToken: TOKEN_B,
        recipient: AUGUSTUS_V6_ADDRESS,
        srcAmount: '1000',
        destAmount: '1',
        wethDeposit: 0n,
        wethWithdraw: 0n,
      });
    });

    it('wraps ETH source tokens before DEX calls when the DEX needs WETH', () => {
      const swap = buildSwap({ srcToken: ETHER_ADDRESS, destToken: TOKEN_B });
      const priceRoute = buildPriceRoute({
        bestRoute: [{ percent: 100, swaps: [swap] }],
      });

      expect(
        buildGenericDexCallParams({
          priceRoute,
          routeIndex: 0,
          swap,
          swapIndex: 0,
          swapExchange: swap.swapExchanges[0],
          minMaxAmount: '900',
          dexNeedWrapNative: true,
          executionContractAddress: EXECUTOR_ADDRESS,
          wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
          augustusV6Address: AUGUSTUS_V6_ADDRESS,
        }),
      ).toMatchObject({
        srcToken: WRAPPED_NATIVE_TOKEN_ADDRESS,
        wethDeposit: 1000n,
      });
    });

    it('scales first BUY leg source amount and routes recipient through executor', () => {
      const swap = buildSwap({
        srcToken: TOKEN_A,
        destToken: TOKEN_B,
        swapExchange: { srcAmount: '200', destAmount: '500' },
      });
      const priceRoute = buildPriceRoute({
        side: SwapSide.BUY,
        srcAmount: '1000',
        bestRoute: [{ percent: 100, swaps: [swap] }],
      });

      expect(
        buildGenericDexCallParams({
          priceRoute,
          routeIndex: 0,
          swap,
          swapIndex: 0,
          swapExchange: swap.swapExchanges[0],
          minMaxAmount: '750',
          dexNeedWrapNative: false,
          executionContractAddress: EXECUTOR_ADDRESS,
          wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
          augustusV6Address: AUGUSTUS_V6_ADDRESS,
        }),
      ).toMatchObject({
        srcAmount: '150',
        destAmount: '500',
        recipient: EXECUTOR_ADDRESS,
      });
    });

    it('forces native withdraw accounting for non-last ETH destination legs', () => {
      const firstSwap = buildSwap({
        srcToken: TOKEN_A,
        destToken: ETHER_ADDRESS,
        swapExchange: { srcAmount: '1000', destAmount: '800' },
      });
      const secondSwap = buildSwap({
        srcToken: ETHER_ADDRESS,
        destToken: TOKEN_C,
        swapExchange: { srcAmount: '800', destAmount: '700' },
      });
      const priceRoute = buildPriceRoute({
        bestRoute: [{ percent: 100, swaps: [firstSwap, secondSwap] }],
      });

      expect(
        buildGenericDexCallParams({
          priceRoute,
          routeIndex: 0,
          swap: firstSwap,
          swapIndex: 0,
          swapExchange: firstSwap.swapExchanges[0],
          minMaxAmount: '900',
          dexNeedWrapNative: false,
          executionContractAddress: EXECUTOR_ADDRESS,
          wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
          augustusV6Address: AUGUSTUS_V6_ADDRESS,
        }),
      ).toMatchObject({
        destToken: ETHER_ADDRESS,
        recipient: EXECUTOR_ADDRESS,
        wethWithdraw: 800n,
      });
    });
  });

  describe('buildResolvedWethPlan', () => {
    it('sums WETH amounts and delegates calldata creation', () => {
      const routePlan = buildRoutePlanFixture();
      const getWethCallData = jest.fn(() => ({
        deposit: {
          callee: WRAPPED_NATIVE_TOKEN_ADDRESS,
          calldata: '0xd0e30db0',
          value: '10',
        },
      }));

      const result = buildResolvedWethPlan({
        resolvedLegsWithWeth: [
          {
            resolvedLeg: buildResolvedLeg({ needWrapNative: true }),
            wethDeposit: 4n,
            wethWithdraw: 1n,
          },
          {
            resolvedLeg: buildResolvedLeg({
              swapExchangeIndex: 1,
              needWrapNative: true,
            }),
            wethDeposit: 6n,
            wethWithdraw: 2n,
          },
        ],
        side: SwapSide.SELL,
        routePlan,
        wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        getWethCallData,
      });

      expect(getWethCallData).toHaveBeenCalledWith('10', '3', SwapSide.SELL);
      expect(result.wethPlan?.deposit?.value).toBe('10');
      expect(result.resolvedLegs).toHaveLength(2);
    });

    it('skips WETH calldata when equal deposit and withdraw have uniform wrap mode', () => {
      const getWethCallData = jest.fn();

      const result = buildResolvedWethPlan({
        resolvedLegsWithWeth: [
          {
            resolvedLeg: buildResolvedLeg({ needWrapNative: true }),
            wethDeposit: 10n,
            wethWithdraw: 10n,
          },
        ],
        side: SwapSide.SELL,
        routePlan: buildSingleLegEthRoutePlan(),
        wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        getWethCallData,
      });

      expect(getWethCallData).not.toHaveBeenCalled();
      expect(result.wethPlan).toBeUndefined();
    });

    it('keeps WETH calldata when equal amounts have mixed wrap modes', () => {
      const getWethCallData = jest.fn(() => ({
        withdraw: {
          callee: AUGUSTUS_V6_ADDRESS,
          calldata: '0x2e1a7d4d',
          value: '0',
        },
      }));

      const result = buildResolvedWethPlan({
        resolvedLegsWithWeth: [
          {
            resolvedLeg: buildResolvedLeg({ needWrapNative: true }),
            wethDeposit: 10n,
            wethWithdraw: 0n,
          },
          {
            resolvedLeg: buildResolvedLeg({
              swapExchangeIndex: 1,
              needWrapNative: false,
            }),
            wethDeposit: 0n,
            wethWithdraw: 10n,
          },
        ],
        side: SwapSide.SELL,
        routePlan: buildRoutePlanFixture({
          srcToken: ETHER_ADDRESS,
          destToken: TOKEN_A,
        }),
        wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        getWethCallData,
      });

      expect(getWethCallData).toHaveBeenCalledWith('10', '10', SwapSide.SELL);
      expect(result.wethPlan?.withdraw?.callee).toBe(AUGUSTUS_V6_ADDRESS);
    });

    it.each([
      { label: 'deposit-only', wethDeposit: 10n, wethWithdraw: 0n },
      { label: 'withdraw-only', wethDeposit: 0n, wethWithdraw: 10n },
    ])('delegates asymmetric $label WETH plans', testCase => {
      const getWethCallData = jest.fn(() => ({
        deposit: {
          callee: WRAPPED_NATIVE_TOKEN_ADDRESS,
          calldata: '0xd0e30db0',
          value: testCase.wethDeposit.toString(),
        },
      }));

      buildResolvedWethPlan({
        resolvedLegsWithWeth: [
          {
            resolvedLeg: buildResolvedLeg({ needWrapNative: true }),
            wethDeposit: testCase.wethDeposit,
            wethWithdraw: testCase.wethWithdraw,
          },
        ],
        side: SwapSide.SELL,
        routePlan: buildSingleLegEthRoutePlan(),
        wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        getWethCallData,
      });

      expect(getWethCallData).toHaveBeenCalledWith(
        testCase.wethDeposit.toString(),
        testCase.wethWithdraw.toString(),
        SwapSide.SELL,
      );
    });
  });

  describe('hasAnyRouteWithEthAndDifferentNeedWrapNative', () => {
    it('detects mixed wrap modes only on ETH/WETH routes', () => {
      const routePlan = buildRoutePlanFixture({
        srcToken: ETHER_ADDRESS,
        destToken: TOKEN_A,
      });

      expect(
        hasAnyRouteWithEthAndDifferentNeedWrapNative({
          routePlan,
          resolvedLegs: [
            buildResolvedLeg({ needWrapNative: true }),
            buildResolvedLeg({ swapExchangeIndex: 1, needWrapNative: true }),
          ],
          wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        }),
      ).toBe(false);

      expect(
        hasAnyRouteWithEthAndDifferentNeedWrapNative({
          routePlan,
          resolvedLegs: [
            buildResolvedLeg({ needWrapNative: true }),
            buildResolvedLeg({ swapExchangeIndex: 1, needWrapNative: false }),
          ],
          wrappedNativeTokenAddress: WRAPPED_NATIVE_TOKEN_ADDRESS,
        }),
      ).toBe(true);
    });
  });

  describe('approval enrichment helpers', () => {
    it('builds approval requests and applies missing approvals by route position', () => {
      const priceRoute = buildPriceRoute({
        bestRoute: [
          {
            percent: 100,
            swaps: [buildSwap({ srcToken: TOKEN_A, destToken: TOKEN_B })],
          },
        ],
      });
      const routePlan = buildSingleLegRoutePlan();
      const resolvedLeg = buildResolvedLeg({
        targetExchange: TARGET_EXCHANGE.toUpperCase(),
        permit2Approval: true,
      });
      const approvalRequests = buildDexExchangeApprovalRequests({
        executorEncodingContext: buildEncodingContext(),
        priceRoute,
        routePlan,
        resolvedLegs: [resolvedLeg],
      });

      expect(approvalRequests).toEqual([
        {
          params: [TOKEN_A, TARGET_EXCHANGE.toUpperCase(), true],
          routePositionKey: '0:0:0',
        },
      ]);

      expect(
        applyDexExchangeApprovalDecisions({
          resolvedLegs: [resolvedLeg],
          approvalRequests,
          approvalDecisions: [false],
        })[0].exchangeParam.approveData,
      ).toEqual({
        token: TOKEN_A,
        target: TARGET_EXCHANGE,
      });

      expect(
        applyDexExchangeApprovalDecisions({
          resolvedLegs: [resolvedLeg],
          approvalRequests,
          approvalDecisions: [true],
        })[0].exchangeParam.approveData,
      ).toBeUndefined();
    });

    it('rejects mismatched approval decision counts', () => {
      expect(() =>
        applyDexExchangeApprovalDecisions({
          resolvedLegs: [buildResolvedLeg()],
          approvalRequests: [
            {
              params: [TOKEN_A, TARGET_EXCHANGE, false],
              routePositionKey: '0:0:0',
            },
          ],
          approvalDecisions: [],
        }),
      ).toThrow('approval decision length must match approval request count');
    });
  });

  describe('buildFeesV6', () => {
    it('uses the shared V6 fee packer for zero-fee partner defaults', () => {
      expect(
        buildFeesV6({
          partnerAddress: NULL_ADDRESS,
          partnerFeePercent: '0',
          takeSurplus: false,
          isCapSurplus: true,
          isSurplusToUser: false,
          isDirectFeeTransfer: false,
        }),
      ).toBe('4951760157141521099596496896');
    });
  });
});

function buildPriceRoute(overrides: Partial<OptimalRate> = {}): OptimalRate {
  return {
    blockNumber: 1,
    network: Network.MAINNET,
    srcToken: TOKEN_A,
    srcDecimals: 18,
    srcAmount: '1000',
    srcUSD: '0',
    destToken: TOKEN_B,
    destDecimals: 18,
    destAmount: '900',
    destUSD: '0',
    bestRoute: [
      {
        percent: 100,
        swaps: [buildSwap({ srcToken: TOKEN_A, destToken: TOKEN_B })],
      },
    ],
    gasCostUSD: '0',
    gasCost: '0',
    side: SwapSide.SELL,
    contractMethod: ContractMethodV6.swapExactAmountIn,
    tokenTransferProxy: NULL_ADDRESS,
    contractAddress: AUGUSTUS_V6_ADDRESS,
    partnerFee: 0,
    hmac: '',
    version: ParaSwapVersion.V6,
    ...overrides,
  } as OptimalRate;
}

function buildSwap({
  srcToken,
  destToken,
  swapExchange = {},
}: {
  srcToken: Address;
  destToken: Address;
  swapExchange?: Partial<OptimalSwapExchange<unknown>>;
}): OptimalSwap {
  return {
    srcToken,
    srcDecimals: 18,
    destToken,
    destDecimals: 18,
    swapExchanges: [
      {
        exchange: 'UniswapV3',
        srcAmount: '1000',
        destAmount: '900',
        percent: 100,
        poolAddresses: [TARGET_EXCHANGE],
        data: null,
        ...swapExchange,
      },
    ],
  } as OptimalSwap;
}

function buildRoutePlanFixture({
  srcToken = TOKEN_A,
  destToken = TOKEN_B,
}: {
  srcToken?: Address;
  destToken?: Address;
} = {}): RoutePlan {
  return {
    routes: [
      {
        percent: 100,
        swaps: [
          {
            srcToken,
            destToken,
            srcAmount: '1000',
            destAmount: '900',
            swapExchanges: [
              {
                exchange: 'UniswapV3',
                percent: 50,
                srcAmount: '500',
                destAmount: '450',
              },
              {
                exchange: 'SushiSwapV3',
                percent: 50,
                srcAmount: '500',
                destAmount: '450',
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildSingleLegRoutePlan(): RoutePlan {
  return {
    routes: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: TOKEN_A,
            destToken: TOKEN_B,
            srcAmount: '1000',
            destAmount: '900',
            swapExchanges: [
              {
                exchange: 'UniswapV3',
                percent: 100,
                srcAmount: '1000',
                destAmount: '900',
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildSingleLegEthRoutePlan(): RoutePlan {
  return {
    routes: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: ETHER_ADDRESS,
            destToken: TOKEN_B,
            srcAmount: '1000',
            destAmount: '900',
            swapExchanges: [
              {
                exchange: 'UniswapV3',
                percent: 100,
                srcAmount: '1000',
                destAmount: '900',
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildResolvedLeg({
  routeIndex = 0,
  swapIndex = 0,
  swapExchangeIndex = 0,
  needWrapNative = false,
  targetExchange = TARGET_EXCHANGE,
  permit2Approval = false,
}: Partial<ResolvedLeg> & Partial<DexExchangeBuildParam> = {}): ResolvedLeg {
  return {
    routeIndex,
    swapIndex,
    swapExchangeIndex,
    normalizedSrcToken: TOKEN_A,
    normalizedDestToken: TOKEN_B,
    normalizedSrcAmount: '1000',
    normalizedDestAmount: '900',
    recipient: AUGUSTUS_V6_ADDRESS,
    exchangeParam: {
      needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: '0x1234',
      targetExchange,
      permit2Approval,
    },
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
