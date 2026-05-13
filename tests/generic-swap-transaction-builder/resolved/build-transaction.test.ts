import { Interface } from '@ethersproject/abi';
import { ContractMethodV6, OptimalRate, ParaSwapVersion } from '@paraswap/core';
import AugustusV6ABI from '../../../src/abi/augustus-v6/ABI.json';
import { Network, NULL_ADDRESS } from '../../../src/constants';
import type { DexAdapterService } from '../../../src/dex';
import { Executor01BytecodeBuilder } from '../../../src/executor/Executor01BytecodeBuilder';
import type { ExecutorBytecodeBuilder } from '../../../src/executor/ExecutorBytecodeBuilder';
import { Executors } from '../../../src/executor/types';
import { GenericSwapTransactionBuilder } from '../../../src/generic-swap-transaction-builder';
import {
  buildRoutePlan,
  buildTransactionFromResolved,
  type BuildInput,
  type ResolvedBuildOutput,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type { DexExchangeBuildParam, TxObject } from '../../../src/types';

import priceRouteFixture from '../../../src/executor/fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
import exchangeParamsFixture from '../../../src/executor/fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-usdt.json';

const AUGUSTUS_V6_INTERFACE = new Interface(AugustusV6ABI);
const USER_ADDRESS = '0x1111111111111111111111111111111111111111';
const AUGUSTUS_V6_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';
const WRAPPED_NATIVE_TOKEN_ADDRESS =
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const EXECUTOR_01_ADDRESS = '0x000010036c0190e009a000d0fc3541100a07380a';
const EXECUTOR_02_ADDRESS = '0x00c600b30fb0400701010f4b080409018b9006e0';
const EXECUTOR_03_ADDRESS = '0xa000b020c290d000020aac04026b5306d60050f0';
const UUID = '11111111-1111-1111-1111-111111111111';
const MIN_MAX_AMOUNT = '990000';
const GAS = {
  gasPrice: '1',
  maxFeePerGas: '2',
  maxPriorityFeePerGas: '3',
};
const mockFn = jest.fn;

describe('resolved generic transaction build', () => {
  it('matches public builder tx and onlyParams for a simple Executor01 SELL route', async () => {
    const priceRoute = buildPriceRoute(ContractMethodV6.swapExactAmountIn);
    const dexHelper = buildDexHelper();
    const bytecodeBuilder = new Executor01BytecodeBuilder(dexHelper);
    const expectedInput = buildInput(priceRoute, dexHelper, bytecodeBuilder);
    const expectedOutput = buildTransactionFromResolved(expectedInput, {
      bytecodeBuilder,
      augustusV6Interface: AUGUSTUS_V6_INTERFACE,
    });
    const dexAdapterService = buildDexAdapterService(dexHelper);
    const builder = new GenericSwapTransactionBuilder(dexAdapterService);

    const actualTx = (await builder.build(buildArgs(priceRoute))) as TxObject;
    const actualParams = (await builder.build({
      ...buildArgs(priceRoute),
      onlyParams: true,
    })) as ResolvedBuildOutput['params'];

    expect(actualTx).toEqual(expectedOutput.txObject);
    expect(actualTx.data).toBe(expectedOutput.txObject.data);
    expect(actualTx.value).toBe(expectedOutput.txObject.value);
    expect(actualTx.from).toBe(expectedOutput.txObject.from);
    expect(actualTx.to).toBe(expectedOutput.txObject.to);
    expect(actualTx.gasPrice).toBe(GAS.gasPrice);
    expect(actualTx.maxFeePerGas).toBe(GAS.maxFeePerGas);
    expect(actualTx.maxPriorityFeePerGas).toBe(GAS.maxPriorityFeePerGas);
    expect(actualParams).toEqual(expectedOutput.params);
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

function buildBoundaryFixture(contractMethod: ContractMethodV6): {
  input: BuildInput;
  bytecodeBuilder: ExecutorBytecodeBuilder;
} {
  const priceRoute = buildPriceRoute(contractMethod);
  const dexHelper = buildDexHelper();
  const bytecodeBuilder = new Executor01BytecodeBuilder(dexHelper);

  return {
    input: buildInput(priceRoute, dexHelper, bytecodeBuilder),
    bytecodeBuilder,
  };
}

function buildPriceRoute(contractMethod: ContractMethodV6): OptimalRate {
  return {
    ...(JSON.parse(JSON.stringify(priceRouteFixture)) as OptimalRate),
    contractMethod,
    version: ParaSwapVersion.V6,
  };
}

function buildInput(
  priceRoute: OptimalRate,
  dexHelper: ReturnType<typeof buildDexHelper>,
  bytecodeBuilder: ExecutorBytecodeBuilder,
): BuildInput {
  const routePlan = buildRoutePlan(priceRoute);
  const swap = priceRoute.bestRoute[0].swaps[0];
  const swapExchange = swap.swapExchanges[0];

  return {
    routePlan,
    resolvedLegs: [
      {
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
        exchangeParam: buildExchangeParam(),
        normalizedSrcToken: swap.srcToken.toLowerCase(),
        normalizedDestToken: swap.destToken.toLowerCase(),
        normalizedSrcAmount: swapExchange.srcAmount,
        normalizedDestAmount: '1',
        recipient: dexHelper.config.data.augustusV6Address!.toLowerCase(),
      },
    ],
    executorType: Executors.ONE,
    executorAddress: bytecodeBuilder.getAddress().toLowerCase(),
    augustusV6Address: dexHelper.config.data.augustusV6Address!.toLowerCase(),
    wrappedNativeTokenAddress:
      dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase(),
    network: Network.MAINNET,
    srcToken: priceRoute.srcToken.toLowerCase(),
    destToken: priceRoute.destToken.toLowerCase(),
    srcAmount: priceRoute.srcAmount,
    destAmount: priceRoute.destAmount,
    minMaxAmount: MIN_MAX_AMOUNT,
    quotedAmount: priceRoute.destAmount,
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
    gas: GAS,
  };
}

function buildArgs(priceRoute: OptimalRate) {
  return {
    priceRoute,
    minMaxAmount: MIN_MAX_AMOUNT,
    quotedAmount: priceRoute.destAmount,
    userAddress: USER_ADDRESS,
    partnerAddress: NULL_ADDRESS,
    partnerFeePercent: '0',
    takeSurplus: false,
    isCapSurplus: true,
    isSurplusToUser: false,
    isDirectFeeTransfer: false,
    ...GAS,
    permit: '0x',
    deadline: '0',
    uuid: UUID,
    beneficiary: NULL_ADDRESS,
  };
}

function buildDexAdapterService(
  dexHelper: ReturnType<typeof buildDexHelper>,
): DexAdapterService {
  return {
    network: Network.MAINNET,
    dexHelper,
    isDirectFunctionNameV6: mockFn().mockReturnValue(false),
    getTxBuilderDexByKey: mockFn().mockReturnValue({
      needWrapNative: true,
      getDexParam: mockFn().mockImplementation(async () =>
        buildExchangeParam(),
      ),
    }),
  } as unknown as DexAdapterService;
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
      hasApprovals: mockFn().mockImplementation(
        async (_spender: string, pairs: unknown[]) => pairs.map(() => true),
      ),
    },
    getLogger: () => ({
      debug: mockFn(),
      info: mockFn(),
      warn: mockFn(),
      error: mockFn(),
    }),
  } as any;
}

function buildExchangeParam(): DexExchangeBuildParam {
  return JSON.parse(
    JSON.stringify(exchangeParamsFixture[0]),
  ) as DexExchangeBuildParam;
}

function cloneBuildInput(input: BuildInput): BuildInput {
  return JSON.parse(JSON.stringify(input)) as BuildInput;
}
