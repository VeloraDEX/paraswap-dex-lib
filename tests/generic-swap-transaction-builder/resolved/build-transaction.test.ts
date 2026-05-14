import { Interface } from '@ethersproject/abi';
import {
  ContractMethodV6,
  OptimalRate,
  ParaSwapVersion,
  SwapSide,
} from '@paraswap/core';
import AugustusV6ABI from '../../../src/abi/augustus-v6/ABI.json';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../../src/constants';
import type { DexAdapterService } from '../../../src/dex';
import type { DepositWithdrawReturn } from '../../../src/dex/weth/types';
import type { ExecutorBytecodeBuilder } from '../../../src/executor/ExecutorBytecodeBuilder';
import { createExecutorEncodingContextFromDexHelper } from '../../../src/executor/encoding-context';
import { createExecutorBytecodeBuilder } from '../../../src/executor/factory';
import { Executors } from '../../../src/executor/types';
import { GenericSwapTransactionBuilder } from '../../../src/generic-swap-transaction-builder';
import {
  buildRoutePlan,
  buildTransactionFromResolved,
  routePositionKey,
  walkRoutePlan,
  type BuildInput,
  type ResolvedBuildOutput,
  type ResolvedLeg,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type {
  Address,
  DexExchangeBuildParam,
  OptimalSwap,
  OptimalSwapExchange,
  TxObject,
} from '../../../src/types';

import executor01SimpleRouteFixture from '../../../src/executor/fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
import executor01SimpleExchangeParamsFixture from '../../../src/executor/fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-usdt.json';
import executor01EthUsdcRouteFixture from '../../../src/executor/fixtures/executor01/routes/price-route-simpleSwap-univ3-eth-usdc.json';
import executor01EthUsdcExchangeParamsFixture from '../../../src/executor/fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-eth-usdc.json';
import executor01EthUsdcWethFixture from '../../../src/executor/fixtures/executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-eth-usdc.json';
import executor01UsdcEthRouteFixture from '../../../src/executor/fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-eth.json';
import executor01UsdcEthExchangeParamsFixture from '../../../src/executor/fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-eth.json';
import executor01UsdcEthWethFixture from '../../../src/executor/fixtures/executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-usdc-eth.json';
import executor01MultiswapRouteFixture from '../../../src/executor/fixtures/executor01/routes/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
import executor01MultiswapExchangeParamsFixture from '../../../src/executor/fixtures/executor01/exchange-params/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
import executor01MultiswapWethFixture from '../../../src/executor/fixtures/executor01/maybe-weth-calldata/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
import executor02VerticalRouteFixture from '../../../src/executor/fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02VerticalExchangeParamsFixture from '../../../src/executor/fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02VerticalWethFixture from '../../../src/executor/fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02MultiswapRouteFixture from '../../../src/executor/fixtures/executor02/routes/price-route-multiswap-univ3-usdt-dai-eth.json';
import executor02MultiswapExchangeParamsFixture from '../../../src/executor/fixtures/executor02/exchange-params/price-route-multiswap-univ3-usdt-dai-eth.json';
import executor02MultiswapWethFixture from '../../../src/executor/fixtures/executor02/maybe-weth-calldata/price-route-multiswap-univ3-usdt-dai-eth.json';

const AUGUSTUS_V6_INTERFACE = new Interface(AugustusV6ABI);
const USER_ADDRESS = '0x1111111111111111111111111111111111111111';
const AUGUSTUS_V6_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';
// Lowercase is intentional: resolved-boundary assertions compare normalized addresses.
const WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const EXECUTOR_01_ADDRESS = '0x000010036c0190e009a000d0fc3541100a07380a';
const EXECUTOR_02_ADDRESS = '0x00c600b30fb0400701010f4b080409018b9006e0';
const EXECUTOR_03_ADDRESS = '0xa000b020c290d000020aac04026b5306d60050f0';
const UUID = '11111111-1111-1111-1111-111111111111';
const MIN_MAX_AMOUNT = '990000';
const WETH_DEX_KEY = 'Weth';
const GAS = {
  gasPrice: '1',
  maxFeePerGas: '2',
  maxPriorityFeePerGas: '3',
};
const mockFn = jest.fn;

type ApprovalPair = [token: Address, target: Address, permit2: boolean];
type ApprovalDecision = (pairs: ApprovalPair[]) => boolean[];

type ParityFixture = {
  priceRoute: OptimalRate;
  exchangeParams: DexExchangeBuildParam[];
  maybeWethCallData?: DepositWithdrawReturn;
  contractMethod?: ContractMethodV6;
  minMaxAmount?: string;
  quotedAmount?: string;
  approvalDecision?: ApprovalDecision;
  gas?: BuildInput['gas'];
};

type ExpectedInputResult = {
  input: BuildInput;
  approvalPairs: ApprovalPair[];
};

type ParityResult = {
  priceRoute: OptimalRate;
  input: BuildInput;
  output: ResolvedBuildOutput;
  tx: TxObject;
  params: ResolvedBuildOutput['params'];
  approvalPairs: ApprovalPair[];
};

type RouteDexFixture = {
  exchange: string;
  swap: OptimalSwap;
  swapExchange: OptimalSwapExchange<any>;
  exchangeParam: DexExchangeBuildParam;
};

describe('resolved generic transaction build', () => {
  it('matches public builder tx and onlyParams for a simple Executor01 SELL route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRouteFixture),
      exchangeParams: buildExchangeParams(
        executor01SimpleExchangeParamsFixture,
      ),
    });

    expect(result.input.executorType).toBe(Executors.ONE);
    expect(result.tx.gasPrice).toBe(GAS.gasPrice);
    expect(result.tx.maxFeePerGas).toBe(GAS.maxFeePerGas);
    expect(result.tx.maxPriorityFeePerGas).toBe(GAS.maxPriorityFeePerGas);
  });

  it('matches public builder tx and onlyParams for an Executor01 WETH deposit route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor01EthUsdcRouteFixture),
      exchangeParams: buildExchangeParams(
        executor01EthUsdcExchangeParamsFixture,
      ),
      maybeWethCallData: cloneWethPlan(executor01EthUsdcWethFixture),
    });

    expect(result.input.executorType).toBe(Executors.ONE);
    expect(result.input.wethPlan?.deposit).toEqual(
      normalizeWethPlan(cloneWethPlan(executor01EthUsdcWethFixture))?.deposit,
    );
    expect(result.tx.value).toBe(result.priceRoute.srcAmount);
  });

  it('matches public builder tx and onlyParams for an Executor01 WETH withdraw route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor01UsdcEthRouteFixture),
      exchangeParams: buildExchangeParams(
        executor01UsdcEthExchangeParamsFixture,
      ),
      maybeWethCallData: cloneWethPlan(executor01UsdcEthWethFixture),
    });

    expect(result.input.executorType).toBe(Executors.ONE);
    expect(result.input.wethPlan?.withdraw).toEqual(
      normalizeWethPlan(cloneWethPlan(executor01UsdcEthWethFixture))?.withdraw,
    );
    expect(result.tx.value).toBe('0');
  });

  it('matches public builder tx and onlyParams for an Executor01 multiswap route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor01MultiswapRouteFixture),
      exchangeParams: buildExchangeParams(
        executor01MultiswapExchangeParamsFixture,
      ),
      maybeWethCallData: cloneWethPlan(executor01MultiswapWethFixture),
    });

    expect(result.input.executorType).toBe(Executors.ONE);
    expect(result.input.resolvedLegs).toHaveLength(2);
  });

  it('matches public builder tx and onlyParams when approval data is required', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor01SimpleRouteFixture),
      exchangeParams: buildExchangeParams(
        executor01SimpleExchangeParamsFixture,
      ),
      approvalDecision: pairs => pairs.map(() => false),
    });

    expect(result.approvalPairs).toHaveLength(1);
    expect(
      result.input.resolvedLegs.some(
        resolvedLeg => resolvedLeg.exchangeParam.approveData !== undefined,
      ),
    ).toBe(true);
  });

  it('matches public builder tx and onlyParams for an Executor02 vertical branch route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor02VerticalRouteFixture),
      exchangeParams: buildExchangeParams(
        executor02VerticalExchangeParamsFixture,
      ),
      maybeWethCallData: cloneWethPlan(executor02VerticalWethFixture),
    });

    expect(result.input.executorType).toBe(Executors.TWO);
    expect(result.input.resolvedLegs).toHaveLength(3);
  });

  it('matches public builder tx and onlyParams for an Executor02 multiswap route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildPriceRouteFromFixture(executor02MultiswapRouteFixture),
      exchangeParams: buildExchangeParams(
        executor02MultiswapExchangeParamsFixture,
      ),
      maybeWethCallData: cloneWethPlan(executor02MultiswapWethFixture),
    });

    expect(result.input.executorType).toBe(Executors.TWO);
    expect(result.input.resolvedLegs).toHaveLength(8);
  });

  it('matches public builder tx and onlyParams for a test-local Executor03 BUY route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildExecutor03BuyPriceRoute(),
      exchangeParams: buildExchangeParams(
        executor01SimpleExchangeParamsFixture,
      ),
      contractMethod: ContractMethodV6.swapExactAmountOut,
    });

    expect(result.input.executorType).toBe(Executors.THREE);
    expect(result.input.side).toBe(SwapSide.BUY);
  });

  it('matches public builder tx and onlyParams for a WETH-only route', async () => {
    const result = await expectPublicBuilderParity({
      priceRoute: buildWethOnlyPriceRoute(),
      exchangeParams: [buildWethOnlyExchangeParam()],
    });

    expect(result.input.executorType).toBe(Executors.WETH);
    expect(result.input.executorAddress).toBe(WRAPPED_NATIVE_TOKEN_ADDRESS);
    expect(result.output.params[4]).toBe('0x');
    expect(result.tx.value).toBe(result.priceRoute.srcAmount);
  });

  it.each([
    ContractMethodV6.swapExactAmountIn,
    ContractMethodV6.swapExactAmountOut,
    ContractMethodV6.swapExactAmountInPro,
    ContractMethodV6.swapExactAmountOutPro,
  ])('assembles generic params for %s', contractMethod => {
    const { input, bytecodeBuilder } = buildBoundaryFixture(contractMethod);
    const output = buildTransactionFromResolved(input, {
      bytecodeBuilder,
      augustusV6Interface: AUGUSTUS_V6_INTERFACE,
    });
    const swapData = output.params[1] as string[];

    expect(output.params[0]).toBe(input.executorAddress);
    expect(swapData).toEqual([
      input.srcToken,
      input.destToken,
      input.srcAmount,
      input.minMaxAmount,
      input.quotedAmount,
      swapData[5],
      input.beneficiary,
    ]);
    expect(output.params[2]).toMatch(/^\d+$/);
    expect(output.params[3]).toBe(input.permit);
    expect(output.txObject.data).toBe(
      AUGUSTUS_V6_INTERFACE.encodeFunctionData(contractMethod, output.params),
    );
  });

  it('rejects unsupported generic contract methods', () => {
    const { input, bytecodeBuilder } = buildBoundaryFixture(
      ContractMethodV6.swapExactAmountIn,
    );

    expect(() =>
      buildTransactionFromResolved(
        {
          ...input,
          contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV2,
        },
        { bytecodeBuilder, augustusV6Interface: AUGUSTUS_V6_INTERFACE },
      ),
    ).toThrow(
      'unsupported generic contract method for resolved build: swapExactAmountInOnUniswapV2',
    );
  });

  it('rejects executor address mismatches', () => {
    const { input, bytecodeBuilder } = buildBoundaryFixture(
      ContractMethodV6.swapExactAmountIn,
    );

    expect(() =>
      buildTransactionFromResolved(
        {
          ...input,
          executorAddress: '0x2222222222222222222222222222222222222222',
        },
        { bytecodeBuilder, augustusV6Interface: AUGUSTUS_V6_INTERFACE },
      ),
    ).toThrow('executor address mismatch');
  });

  it('rejects out-of-route resolved leg keys', () => {
    const { input, bytecodeBuilder } = buildBoundaryFixture(
      ContractMethodV6.swapExactAmountIn,
    );
    const invalidInput = cloneBuildInput(input);
    invalidInput.resolvedLegs[0].swapExchangeIndex = 1;

    expect(() =>
      buildTransactionFromResolved(invalidInput, {
        bytecodeBuilder,
        augustusV6Interface: AUGUSTUS_V6_INTERFACE,
      }),
    ).toThrow('resolved leg route position 0:0:1 is not in route plan');
  });

  it('rejects non-boolean resolved needWrapNative values', () => {
    const { input, bytecodeBuilder } = buildBoundaryFixture(
      ContractMethodV6.swapExactAmountIn,
    );
    const invalidInput = cloneBuildInput(input);
    invalidInput.resolvedLegs[0].exchangeParam.needWrapNative = (() =>
      true) as any;

    expect(() =>
      buildTransactionFromResolved(invalidInput, {
        bytecodeBuilder,
        augustusV6Interface: AUGUSTUS_V6_INTERFACE,
      }),
    ).toThrow('resolvedLegs[0].exchangeParam.needWrapNative must be boolean');
  });

  it('rejects malformed WETH plans', () => {
    const { input, bytecodeBuilder } = buildBoundaryFixture(
      ContractMethodV6.swapExactAmountIn,
    );
    const invalidInput = {
      ...cloneBuildInput(input),
      wethPlan: {
        deposit: {
          callee: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          calldata: '0x',
          value: '1',
        },
      },
    };

    expect(() =>
      buildTransactionFromResolved(invalidInput, {
        bytecodeBuilder,
        augustusV6Interface: AUGUSTUS_V6_INTERFACE,
      }),
    ).toThrow(
      'wethPlan.deposit.callee must be a lowercase 42-character hex address',
    );
  });
});

async function expectPublicBuilderParity(
  fixture: ParityFixture,
): Promise<ParityResult> {
  const priceRoute = buildTestPriceRoute({
    ...clone(fixture.priceRoute),
    contractMethod:
      fixture.contractMethod ??
      (fixture.priceRoute.contractMethod as ContractMethodV6) ??
      ContractMethodV6.swapExactAmountIn,
  });
  const minMaxAmount = getMinMaxAmount(priceRoute, fixture.minMaxAmount);
  const quotedAmount = getQuotedAmount(priceRoute, fixture.quotedAmount);
  const gas = fixture.gas ?? GAS;
  const approvalDecision =
    fixture.approvalDecision ??
    ((pairs: ApprovalPair[]) => pairs.map(() => true));
  const dexHelper = buildDexHelper();
  const dexAdapterService = buildDexAdapterService({
    priceRoute,
    dexHelper,
    exchangeParams: fixture.exchangeParams,
    maybeWethCallData: fixture.maybeWethCallData,
    approvalDecision,
  });
  const builder = new GenericSwapTransactionBuilder(dexAdapterService);
  const executorType =
    builder.executorDetector.getExecutorByPriceRoute(priceRoute);
  const bytecodeBuilder = createTestExecutorBytecodeBuilder(
    dexHelper,
    executorType,
  );
  const expectedInput = buildExpectedInput({
    priceRoute,
    minMaxAmount,
    quotedAmount,
    gas,
    dexHelper,
    builder,
    bytecodeBuilder,
    executorType,
    exchangeParams: fixture.exchangeParams,
    maybeWethCallData: fixture.maybeWethCallData,
    approvalDecision,
  });
  const expectedOutput = buildTransactionFromResolved(expectedInput.input, {
    bytecodeBuilder,
    augustusV6Interface: AUGUSTUS_V6_INTERFACE,
  });

  const tx = (await builder.build(
    buildArgs(priceRoute, minMaxAmount, quotedAmount, gas),
  )) as TxObject;
  const params = (await builder.build({
    ...buildArgs(priceRoute, minMaxAmount, quotedAmount, gas),
    onlyParams: true,
  })) as ResolvedBuildOutput['params'];

  expect(tx).toEqual(expectedOutput.txObject);
  expect(tx.data).toBe(expectedOutput.txObject.data);
  expect(tx.value).toBe(expectedOutput.txObject.value);
  expect(tx.from).toBe(expectedOutput.txObject.from);
  expect(tx.to).toBe(expectedOutput.txObject.to);
  expect(params).toEqual(expectedOutput.params);

  return {
    priceRoute,
    input: expectedInput.input,
    output: expectedOutput,
    tx,
    params,
    approvalPairs: expectedInput.approvalPairs,
  };
}

function buildExpectedInput({
  priceRoute,
  minMaxAmount,
  quotedAmount,
  gas,
  dexHelper,
  builder,
  bytecodeBuilder,
  executorType,
  exchangeParams,
  maybeWethCallData,
  approvalDecision,
}: {
  priceRoute: OptimalRate;
  minMaxAmount: string;
  quotedAmount: string;
  gas: BuildInput['gas'];
  dexHelper: ReturnType<typeof buildDexHelper>;
  builder: GenericSwapTransactionBuilder;
  bytecodeBuilder: ExecutorBytecodeBuilder;
  executorType: Executors;
  exchangeParams: DexExchangeBuildParam[];
  maybeWethCallData?: DepositWithdrawReturn;
  approvalDecision: ApprovalDecision;
}): ExpectedInputResult {
  const routePlan = buildRoutePlan(priceRoute);
  const routePositions = walkRoutePlan(routePlan);

  expect(exchangeParams).toHaveLength(routePositions.length);

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
          bytecodeBuilder.getAddress(),
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
    bytecodeBuilder,
    priceRoute,
    routePlan,
    resolvedLegs: resolvedLegsWithoutApprovals,
    approvalDecision,
  });

  return {
    approvalPairs: approvalResult.approvalPairs,
    input: {
      routePlan,
      resolvedLegs: approvalResult.resolvedLegs,
      wethPlan: normalizeWethPlan(maybeWethCallData),
      executorType,
      executorAddress: normalizeAddress(bytecodeBuilder.getAddress()),
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
      beneficiary: NULL_ADDRESS,
      permit: '0x',
      uuid: UUID,
      fee: {
        partnerAddress: NULL_ADDRESS,
        partnerFeePercent: '0',
        takeSurplus: false,
        isCapSurplus: true,
        isSurplusToUser: false,
        isDirectFeeTransfer: false,
      },
      gas,
    },
  };
}

function addApprovalData({
  bytecodeBuilder,
  priceRoute,
  routePlan,
  resolvedLegs,
  approvalDecision,
}: {
  bytecodeBuilder: ExecutorBytecodeBuilder;
  priceRoute: OptimalRate;
  routePlan: BuildInput['routePlan'];
  resolvedLegs: ResolvedLeg[];
  approvalDecision: ApprovalDecision;
}): { resolvedLegs: ResolvedLeg[]; approvalPairs: ApprovalPair[] } {
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
    const approveParams = bytecodeBuilder.getApprovalTokenAndTarget(
      swap,
      resolvedLeg.exchangeParam,
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
  const approvals = approvalDecision(approvalPairs);

  if (approvals.length !== approvalPairs.length) {
    throw new Error('approval decision length must match approval pair count');
  }

  approvals.forEach((alreadyApproved, index) => {
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

function buildBoundaryFixture(contractMethod: ContractMethodV6): {
  input: BuildInput;
  bytecodeBuilder: ExecutorBytecodeBuilder;
} {
  const priceRoute = buildPriceRouteFromFixture(executor01SimpleRouteFixture, {
    contractMethod,
  });
  const dexHelper = buildDexHelper();
  const dexAdapterService = buildDexAdapterService({
    priceRoute,
    dexHelper,
    exchangeParams: buildExchangeParams(executor01SimpleExchangeParamsFixture),
    approvalDecision: pairs => pairs.map(() => true),
  });
  const builder = new GenericSwapTransactionBuilder(dexAdapterService);
  const executorType =
    builder.executorDetector.getExecutorByPriceRoute(priceRoute);
  const bytecodeBuilder = createTestExecutorBytecodeBuilder(
    dexHelper,
    executorType,
  );

  return {
    input: buildExpectedInput({
      priceRoute,
      minMaxAmount: getMinMaxAmount(priceRoute),
      quotedAmount: getQuotedAmount(priceRoute),
      gas: GAS,
      dexHelper,
      builder,
      bytecodeBuilder,
      executorType,
      exchangeParams: buildExchangeParams(
        executor01SimpleExchangeParamsFixture,
      ),
      approvalDecision: pairs => pairs.map(() => true),
    }).input,
    bytecodeBuilder,
  };
}

function buildPriceRouteFromFixture(
  fixture: unknown,
  overrides: Partial<OptimalRate> = {},
): OptimalRate {
  return buildTestPriceRoute({
    ...(clone(fixture) as OptimalRate),
    // Force generic SELL fixtures into swapExactAmountIn by default; callers override for BUY/Pro cases.
    contractMethod: ContractMethodV6.swapExactAmountIn,
    ...overrides,
  });
}

function createTestExecutorBytecodeBuilder(
  dexHelper: ReturnType<typeof buildDexHelper>,
  executorType: Executors,
): ExecutorBytecodeBuilder {
  return createExecutorBytecodeBuilder(
    executorType,
    createExecutorEncodingContextFromDexHelper(dexHelper),
  );
}

function buildExecutor03BuyPriceRoute(): OptimalRate {
  return buildPriceRouteFromFixture(executor01SimpleRouteFixture, {
    side: SwapSide.BUY,
    contractMethod: ContractMethodV6.swapExactAmountOut,
  });
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

function buildExchangeParams(fixture: unknown): DexExchangeBuildParam[] {
  return clone(fixture) as DexExchangeBuildParam[];
}

function buildWethOnlyExchangeParam(): DexExchangeBuildParam {
  return {
    needWrapNative: false,
    dexFuncHasRecipient: false,
    exchangeData: '0xd0e30db0',
    targetExchange: WRAPPED_NATIVE_TOKEN_ADDRESS,
  };
}

function buildArgs(
  priceRoute: OptimalRate,
  minMaxAmount = getMinMaxAmount(priceRoute),
  quotedAmount = getQuotedAmount(priceRoute),
  gas: BuildInput['gas'] = GAS,
) {
  return {
    priceRoute,
    minMaxAmount,
    quotedAmount,
    userAddress: USER_ADDRESS,
    partnerAddress: NULL_ADDRESS,
    partnerFeePercent: '0',
    takeSurplus: false,
    isCapSurplus: true,
    isSurplusToUser: false,
    isDirectFeeTransfer: false,
    ...gas,
    permit: '0x',
    deadline: '0',
    uuid: UUID,
    beneficiary: NULL_ADDRESS,
  };
}

function buildDexAdapterService({
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

  dexHelper.augustusApprovals.hasApprovals = mockFn().mockImplementation(
    async (_spender: string, pairs: ApprovalPair[]) => approvalDecision(pairs),
  );

  return {
    network: priceRoute.network,
    dexHelper,
    isDirectFunctionNameV6: mockFn().mockReturnValue(false),
    getTxBuilderDexByKey: mockFn().mockImplementation((dexKey: string) => {
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
          getDexParam: mockFn().mockImplementation(
            async (
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
          ),
        };
      }

      if (dexKey === WETH_DEX_KEY) {
        return {
          needWrapNative: false,
          getDexParam: mockFn().mockResolvedValue(buildWethOnlyExchangeParam()),
          getDepositWithdrawParam: mockFn().mockReturnValue(
            cloneWethPlan(maybeWethCallData),
          ),
        };
      }

      throw new Error(`unexpected DEX lookup in test: ${dexKey}`);
    }),
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
    throw new Error(`unexpected route-position DEX lookup in test: ${dexKey}`);
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
    throw new Error(`unexpected getDexParam lookup in test: ${dexKey}`);
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
      hasApprovals: mockFn(),
    },
    getLogger: () => ({
      debug: mockFn(),
      info: mockFn(),
      warn: mockFn(),
      error: mockFn(),
    }),
  } as any;
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

function cloneBuildInput(input: BuildInput): BuildInput {
  return clone(input);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
