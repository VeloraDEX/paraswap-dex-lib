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
import { GenericSwapTransactionBuilder } from '../../../src/generic-swap-transaction-builder';
import {
  buildFeesV6,
  buildDirectTransactionFromResolved,
  type DirectBuildInput,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type { Address, TxInfo, TxObject } from '../../../src/types';

const AUGUSTUS_V6_INTERFACE = new Interface(AugustusV6ABI);
const USER_ADDRESS = '0x1111111111111111111111111111111111111111';
const AUGUSTUS_V6_ADDRESS = '0x6a000f20005980200259b80c5102003040001068';
const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const POOL_ADDRESS = '0xcccccccccccccccccccccccccccccccccccccccc';
const MAKER_ADDRESS = '0xdddddddddddddddddddddddddddddddddddddddd';
const TAKER_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const PARTNER_ADDRESS = '0x3333333333333333333333333333333333333333';
const UUID = '11111111-1111-1111-1111-111111111111';
const METADATA = `0x${'11'.repeat(32)}`;
const GAS = {
  gasPrice: '1',
  maxFeePerGas: '2',
  maxPriorityFeePerGas: '3',
};
const mockFn = jest.fn;

type DirectDexResult = TxInfo<unknown[]>;

type DirectCase = {
  title: string;
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
};

type DirectBuildArgOverrides = Partial<{
  referrerAddress: Address;
  partnerAddress: Address;
  partnerFeePercent: string;
  takeSurplus: boolean;
  isCapSurplus: boolean;
  isSurplusToUser: boolean;
  isDirectFeeTransfer: boolean;
  permit: string;
  beneficiary: Address;
}>;

describe('resolved direct transaction build', () => {
  const directCases: DirectCase[] = [
    {
      title: 'UniswapV2 SELL',
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
      title: 'UniswapV2 BUY',
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
      title: 'UniswapV3 SELL',
      dexKey: 'UniswapV3',
      contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV3,
      side: SwapSide.SELL,
      params: buildUniParams(TOKEN_A, TOKEN_B, '1000', '990', '995'),
    },
    {
      title: 'BalancerV2 BUY',
      dexKey: 'BalancerV2',
      contractMethod: ContractMethodV6.swapExactAmountOutOnBalancerV2,
      side: SwapSide.BUY,
      minMaxAmount: '1200',
      quotedAmount: '1100',
      params: [['1200', '1000', '1100', METADATA, '0'], '0', '0x', '0x1234'],
    },
    {
      title: 'CurveV1 SELL',
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
      title: 'LitePsm',
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
      title: 'Augustus RFQ try-batch-fill',
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

  it.each(directCases)(
    'matches public builder tx, onlyParams, and DEX encoder bytes for $title',
    async directCase => {
      const result = await expectDirectPublicBuilderParity(directCase);

      expect(result.boundaryOutput.txObject.data).toBe(
        result.dexResult.encoder(...result.dexResult.params),
      );
      expect(result.tx.data).toBe(result.dexResult.encoder(...result.params));
    },
  );

  it('passes native source value and gas fields through direct tx output', async () => {
    const result = await expectDirectPublicBuilderParity(directCases[0]);

    expect(result.tx.value).toBe(result.priceRoute.srcAmount);
    expect(result.tx.gasPrice).toBe(GAS.gasPrice);
    expect(result.tx.maxFeePerGas).toBe(GAS.maxFeePerGas);
    expect(result.tx.maxPriorityFeePerGas).toBe(GAS.maxPriorityFeePerGas);
  });

  it('passes packed nonzero partner fee to direct DEX encoder', async () => {
    const feeArgs = {
      partnerAddress: PARTNER_ADDRESS,
      partnerFeePercent: '25',
      isCapSurplus: true,
      isDirectFeeTransfer: true,
    };

    const result = await expectDirectPublicBuilderParity(
      directCases[2],
      feeArgs,
    );

    expect(result.directDex.getDirectParamV6).toHaveBeenCalledTimes(2);
  });

  it('passes explicit SELL quotedAmount overrides to direct DEX encoder', async () => {
    await expectDirectPublicBuilderParity({
      ...directCases[2],
      title: 'UniswapV3 SELL with quotedAmount override',
      quotedAmount: '875',
      params: buildUniParams(TOKEN_A, TOKEN_B, '1000', '990', '875'),
    });
  });

  it('rejects malformed direct permit before calling the direct DEX encoder', async () => {
    const directCase = directCases[2];
    const priceRoute = buildDirectPriceRoute(directCase);
    const dexResult = buildDirectDexResult(directCase);
    const { dexAdapterService, directDex } = buildDexAdapterService(
      directCase,
      dexResult,
    );
    const builder = new GenericSwapTransactionBuilder(dexAdapterService);

    await expect(
      builder.build(
        buildArgs(priceRoute, directCase.minMaxAmount ?? '990', '995', {
          permit: 'not-hex',
        }),
      ),
    ).rejects.toThrow('permit must be 0x-prefixed hex bytes');
    expect(directDex.getDirectParamV6).not.toHaveBeenCalled();
  });

  it('calculates BUY native source value from minMaxAmount', () => {
    const input = buildDirectInput({
      contractMethod: ContractMethodV6.swapExactAmountOutOnUniswapV2,
      params: buildUniParams(ETHER_ADDRESS, TOKEN_A, '1200', '1000', '1100'),
      srcToken: ETHER_ADDRESS,
      minMaxAmount: '1200',
      side: SwapSide.BUY,
    });

    const output = buildDirectTransactionFromResolved(input, {
      augustusV6Interface: AUGUSTUS_V6_INTERFACE,
    });

    expect(output.txObject.value).toBe('1200');
  });

  it('rejects unsupported direct contract methods', () => {
    const input = buildDirectInput({
      contractMethod: ContractMethodV6.swapExactAmountIn,
      params: buildUniParams(TOKEN_A, TOKEN_B, '1000', '990', '995'),
    });

    expect(() =>
      buildDirectTransactionFromResolved(input, {
        augustusV6Interface: AUGUSTUS_V6_INTERFACE,
      }),
    ).toThrow(
      'unsupported direct contract method for resolved build: swapExactAmountIn',
    );
  });

  it('rejects direct side and method mismatches', () => {
    const input = buildDirectInput({
      contractMethod: ContractMethodV6.swapExactAmountOutOnUniswapV2,
      params: buildUniParams(TOKEN_A, TOKEN_B, '1000', '990', '995'),
      side: SwapSide.SELL,
    });

    expect(() =>
      buildDirectTransactionFromResolved(input, {
        augustusV6Interface: AUGUSTUS_V6_INTERFACE,
      }),
    ).toThrow(
      'direct contract method swapExactAmountOutOnUniswapV2 is inconsistent with side SELL; expected BUY',
    );
  });

  it('rejects malformed direct wrapper fields', () => {
    const input = buildDirectInput({
      params: buildUniParams(TOKEN_A, TOKEN_B, '1000', '990', '995'),
    });

    expect(() =>
      buildDirectTransactionFromResolved(
        {
          ...input,
          userAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
        { augustusV6Interface: AUGUSTUS_V6_INTERFACE },
      ),
    ).toThrow('userAddress must be a lowercase 42-character hex address');

    expect(() =>
      buildDirectTransactionFromResolved(
        {
          ...input,
          srcAmount: '1.5',
        },
        { augustusV6Interface: AUGUSTUS_V6_INTERFACE },
      ),
    ).toThrow('srcAmount must be a decimal amount string');

    expect(() =>
      buildDirectTransactionFromResolved(
        {
          ...input,
          gas: {
            gasPrice: '1.5',
          },
        },
        { augustusV6Interface: AUGUSTUS_V6_INTERFACE },
      ),
    ).toThrow('gas.gasPrice must be a decimal amount string');

    expect(() =>
      buildDirectTransactionFromResolved(
        {
          ...input,
          side: 'INVALID' as SwapSide,
        },
        { augustusV6Interface: AUGUSTUS_V6_INTERFACE },
      ),
    ).toThrow('direct side must be SELL or BUY: INVALID');
  });

  it.each([null, '0x'])(
    'rejects non-array direct params: %p',
    malformedParams => {
      const input = buildDirectInput({
        params: malformedParams as unknown as unknown[],
      });

      expect(() =>
        buildDirectTransactionFromResolved(input, {
          augustusV6Interface: AUGUSTUS_V6_INTERFACE,
        }),
      ).toThrow('direct params must be an array');
    },
  );
});

async function expectDirectPublicBuilderParity(
  directCase: DirectCase,
  buildArgOverrides: DirectBuildArgOverrides = {},
) {
  const priceRoute = buildDirectPriceRoute(directCase);
  const minMaxAmount = directCase.minMaxAmount ?? '990';
  const quotedAmount = directCase.quotedAmount ?? priceRoute.destAmount;
  const dexResult = buildDirectDexResult(directCase);
  const { dexAdapterService, directDex } = buildDexAdapterService(
    directCase,
    dexResult,
  );
  const capturedDirectBuildInputs: DirectBuildInput[] = [];
  const builder = new GenericSwapTransactionBuilder(dexAdapterService, {
    resolvedBuildInputObserver: {
      onDirectBuildInput: input => capturedDirectBuildInputs.push(clone(input)),
    },
  });
  const boundaryInput = buildDirectInput({
    contractMethod: directCase.contractMethod,
    params: dexResult.params,
    srcToken: normalizeAddress(priceRoute.srcToken),
    srcAmount: priceRoute.srcAmount,
    minMaxAmount,
    side: directCase.side,
    gas: GAS,
  });
  const boundaryOutput = buildDirectTransactionFromResolved(boundaryInput, {
    augustusV6Interface: AUGUSTUS_V6_INTERFACE,
  });
  const args = buildArgs(
    priceRoute,
    minMaxAmount,
    quotedAmount,
    buildArgOverrides,
  );
  const expectedPartnerAndFee = buildFeesV6({
    referrerAddress: args.referrerAddress,
    partnerAddress: args.partnerAddress,
    partnerFeePercent: args.partnerFeePercent,
    takeSurplus: args.takeSurplus,
    isCapSurplus: args.isCapSurplus,
    isSurplusToUser: args.isSurplusToUser,
    isDirectFeeTransfer: args.isDirectFeeTransfer,
  });

  const tx = (await builder.build(args)) as TxObject;
  const params = (await builder.build({
    ...args,
    onlyParams: true,
  })) as unknown[];

  expect(tx).toEqual(boundaryOutput.txObject);
  expect(params).toEqual(boundaryOutput.params);
  expect(params).toEqual(dexResult.params);
  expect(capturedDirectBuildInputs).toEqual([boundaryInput, boundaryInput]);
  expect(directDex.getDirectParamV6).toHaveBeenCalledWith(
    priceRoute.srcToken,
    priceRoute.destToken,
    directCase.side === SwapSide.SELL
      ? priceRoute.bestRoute[0].swaps[0].swapExchanges[0].srcAmount
      : minMaxAmount,
    directCase.side === SwapSide.SELL
      ? minMaxAmount
      : priceRoute.bestRoute[0].swaps[0].swapExchanges[0].destAmount,
    quotedAmount,
    priceRoute.bestRoute[0].swaps[0].swapExchanges[0].data,
    directCase.side,
    args.permit,
    UUID,
    expectedPartnerAndFee,
    args.beneficiary,
    priceRoute.blockNumber,
    directCase.contractMethod,
  );

  return {
    priceRoute,
    boundaryOutput,
    dexResult,
    directDex,
    tx,
    params,
  };
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
                data: { directCase: directCase.title },
              },
            ],
          },
        ],
      },
    ],
  });
}

function buildTestPriceRoute(partial: Partial<OptimalRate>): OptimalRate {
  return {
    blockNumber: 1,
    network: Network.MAINNET,
    srcToken: TOKEN_A,
    srcDecimals: 18,
    srcAmount: '1000',
    srcUSD: '0',
    destToken: TOKEN_B,
    destDecimals: 18,
    destAmount: '995',
    destUSD: '0',
    bestRoute: [],
    gasCostUSD: '0',
    gasCost: '0',
    side: SwapSide.SELL,
    contractMethod: ContractMethodV6.swapExactAmountInOnUniswapV2,
    tokenTransferProxy: NULL_ADDRESS,
    contractAddress: AUGUSTUS_V6_ADDRESS,
    partnerFee: 0,
    hmac: '',
    version: ParaSwapVersion.V6,
    ...partial,
  } as OptimalRate;
}

function buildDexAdapterService(
  directCase: DirectCase,
  dexResult: DirectDexResult,
): {
  dexAdapterService: DexAdapterService;
  directDex: {
    needWrapNative: boolean;
    getDirectParamV6: jest.Mock;
    getDirectFunctionNameV6: jest.Mock;
  };
} {
  const dexHelper = buildDexHelper();
  const directDex = {
    needWrapNative: false,
    getDirectParamV6: mockFn().mockReturnValue(dexResult),
    getDirectFunctionNameV6: mockFn().mockReturnValue([
      directCase.contractMethod,
    ]),
  };

  return {
    directDex,
    dexAdapterService: {
      network: Network.MAINNET,
      dexHelper,
      isDirectFunctionNameV6: mockFn().mockImplementation(
        (contractMethod: ContractMethodV6) =>
          contractMethod === directCase.contractMethod,
      ),
      getTxBuilderDexByKey: mockFn().mockImplementation((dexKey: string) => {
        if (dexKey === directCase.dexKey) return directDex;
        throw new Error(`unexpected DEX lookup in test: ${dexKey}`);
      }),
    } as unknown as DexAdapterService,
  };
}

function buildDexHelper() {
  return {
    config: {
      data: {
        network: Network.MAINNET,
        augustusV6Address: AUGUSTUS_V6_ADDRESS,
      },
    },
    getLogger: () => ({
      debug: mockFn(),
      info: mockFn(),
      warn: mockFn(),
      error: mockFn(),
    }),
  } as any;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildDirectDexResult(directCase: DirectCase): DirectDexResult {
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

function buildArgs(
  priceRoute: OptimalRate,
  minMaxAmount: string,
  quotedAmount: string,
  overrides: DirectBuildArgOverrides = {},
) {
  return {
    priceRoute,
    minMaxAmount,
    quotedAmount,
    userAddress: USER_ADDRESS,
    partnerAddress: NULL_ADDRESS,
    partnerFeePercent: '0',
    takeSurplus: false,
    isCapSurplus: false,
    isSurplusToUser: false,
    isDirectFeeTransfer: false,
    ...GAS,
    permit: '0x',
    deadline: '0',
    uuid: UUID,
    beneficiary: NULL_ADDRESS,
    ...overrides,
  };
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase();
}
