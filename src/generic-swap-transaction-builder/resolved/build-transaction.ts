import { Interface } from '@ethersproject/abi';
import { ContractMethodV6, SwapSide } from '@paraswap/core';
import { BigNumber, ethers } from 'ethers';
import {
  ETHER_ADDRESS,
  FEE_PERCENT_IN_BASIS_POINTS_MASK,
  IS_CAP_SURPLUS_MASK,
  IS_DIRECT_TRANSFER_MASK,
  IS_REFERRAL_MASK,
  IS_SKIP_BLACKLIST_MASK,
  IS_TAKE_SURPLUS_MASK,
  IS_USER_SURPLUS_MASK,
  NULL_ADDRESS,
} from '../../constants';
import type { ExecutorEncodingContext } from '../../executor/encoding-types';
import { createExecutorBytecodeBuilder } from '../../executor/factory';
import { Executors } from '../../executor/types';
import type { Address, DexExchangeBuildParam, TxObject } from '../../types';
import { uuidToBytes16 } from '../../utils';
import {
  assertDecimalAmountString,
  assertHexBytes,
  assertLowercaseAddress,
  assertNoDuplicateResolvedLegs,
  assertRoutePlanLegCount,
} from './validation';
import { routePositionKey, walkRoutePlan } from './route-plan';
import type {
  BuildInput,
  DirectBuildInput,
  FeeInput,
  ResolvedBuildOutput,
  ResolvedDirectBuildOutput,
  ResolvedLeg,
  RoutePlan,
} from './types';

const {
  utils: { hexlify, hexConcat, hexZeroPad },
} = ethers;

const GENERIC_CONTRACT_METHODS = new Set<string>([
  ContractMethodV6.swapExactAmountIn,
  ContractMethodV6.swapExactAmountOut,
  ContractMethodV6.swapExactAmountInPro,
  ContractMethodV6.swapExactAmountOutPro,
]);

const DIRECT_CONTRACT_METHODS = new Set<string>([
  ContractMethodV6.swapExactAmountInOnUniswapV2,
  ContractMethodV6.swapExactAmountOutOnUniswapV2,
  ContractMethodV6.swapExactAmountInOnUniswapV3,
  ContractMethodV6.swapExactAmountOutOnUniswapV3,
  ContractMethodV6.swapExactAmountInOnBalancerV2,
  ContractMethodV6.swapExactAmountOutOnBalancerV2,
  ContractMethodV6.swapExactAmountInOnCurveV1,
  ContractMethodV6.swapExactAmountInOnCurveV2,
  ContractMethodV6.swapOnAugustusRFQTryBatchFill,
  ContractMethodV6.swapExactAmountInOutOnMakerPSM,
]);

const DIRECT_CONTRACT_METHOD_SIDES = new Map<string, SwapSide>([
  [ContractMethodV6.swapExactAmountInOnUniswapV2, SwapSide.SELL],
  [ContractMethodV6.swapExactAmountOutOnUniswapV2, SwapSide.BUY],
  [ContractMethodV6.swapExactAmountInOnUniswapV3, SwapSide.SELL],
  [ContractMethodV6.swapExactAmountOutOnUniswapV3, SwapSide.BUY],
  [ContractMethodV6.swapExactAmountInOnBalancerV2, SwapSide.SELL],
  [ContractMethodV6.swapExactAmountOutOnBalancerV2, SwapSide.BUY],
  [ContractMethodV6.swapExactAmountInOnCurveV1, SwapSide.SELL],
  [ContractMethodV6.swapExactAmountInOnCurveV2, SwapSide.SELL],
]);

export type ResolvedBuildDeps = {
  encodingContext: ExecutorEncodingContext;
  augustusV6Interface: Interface;
};

export type ResolvedDirectBuildDeps = {
  augustusV6Interface: Interface;
};

type FeeParams = {
  partner: string;
  feePercent: string;
  isTakeSurplus: boolean;
  isCapSurplus: boolean;
  isSurplusToUser: boolean;
  isDirectFeeTransfer: boolean;
  isReferral: boolean;
  isSkipBlacklist: boolean;
};

export function buildTransactionFromResolved(
  input: BuildInput,
  deps: ResolvedBuildDeps,
): ResolvedBuildOutput {
  validateBuildInput(input, deps);

  const bytecodeBuilder = createExecutorBytecodeBuilder(
    input.executorType,
    deps.encodingContext,
  );
  const bytecode = bytecodeBuilder.buildByteCode({
    routePlan: input.routePlan,
    resolvedLegs: input.resolvedLegs,
    sender: input.userAddress,
    srcToken: input.srcToken,
    destToken: input.destToken,
    destAmount: input.destAmount,
    wethPlan: input.wethPlan,
  });

  const params = buildGenericSwapParams(input, bytecode);
  const txObject = buildTxObject(input, params, deps.augustusV6Interface);

  return { params, txObject };
}

export function buildDirectTransactionFromResolved(
  input: DirectBuildInput,
  deps: ResolvedDirectBuildDeps,
): ResolvedDirectBuildOutput {
  validateDirectBuildInput(input);

  const txObject = buildDirectTxObject(
    input,
    input.params,
    deps.augustusV6Interface,
  );

  return {
    contractMethod: input.contractMethod,
    params: input.params,
    txObject,
  };
}

function validateBuildInput(
  input: BuildInput,
  deps: ResolvedBuildDeps,
): Map<string, ResolvedLeg> {
  validateSupportedContractMethod(input.contractMethod);
  validateExecutor(input, deps);
  validateTopLevelFields(input);
  validateEncodingContext(input, deps);
  validateRoutePlan(input.routePlan);
  validateWethPlan(input);

  // Boundary validation owns user-facing fixture/input diagnostics. Executor
  // ordering helpers re-check these invariants before bytecode traversal.
  assertNoDuplicateResolvedLegs(input.resolvedLegs);
  assertRoutePlanLegCount(input.routePlan, input.resolvedLegs);

  const routeKeys = new Set(
    walkRoutePlan(input.routePlan).map(routePositionKey),
  );
  const resolvedLegByKey = new Map<string, ResolvedLeg>();

  input.resolvedLegs.forEach((resolvedLeg, index) => {
    const key = routePositionKey(resolvedLeg);

    if (!routeKeys.has(key)) {
      throw new Error(
        `resolved leg route position ${key} is not in route plan`,
      );
    }

    validateResolvedLeg(resolvedLeg, index);
    resolvedLegByKey.set(key, resolvedLeg);
  });

  routeKeys.forEach(key => {
    if (!resolvedLegByKey.has(key)) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }
  });

  return resolvedLegByKey;
}

function validateDirectBuildInput(input: DirectBuildInput): void {
  validateSupportedDirectContractMethod(input.contractMethod);
  validateDirectSide(input.side);
  validateDirectSideContractMethod(input.contractMethod, input.side);
  validateDirectTopLevelFields(input);
}

function validateSupportedContractMethod(
  contractMethod: ContractMethodV6,
): void {
  if (!GENERIC_CONTRACT_METHODS.has(contractMethod)) {
    throw new Error(
      `unsupported generic contract method for resolved build: ${contractMethod}`,
    );
  }
}

function validateSupportedDirectContractMethod(
  contractMethod: ContractMethodV6,
): void {
  if (!DIRECT_CONTRACT_METHODS.has(contractMethod)) {
    throw new Error(
      `unsupported direct contract method for resolved build: ${contractMethod}`,
    );
  }
}

function validateDirectSide(side: SwapSide): void {
  if (side !== SwapSide.SELL && side !== SwapSide.BUY) {
    throw new Error(`direct side must be SELL or BUY: ${side}`);
  }
}

function validateDirectSideContractMethod(
  contractMethod: ContractMethodV6,
  side: SwapSide,
): void {
  const expectedSide = DIRECT_CONTRACT_METHOD_SIDES.get(contractMethod);

  if (expectedSide !== undefined && side !== expectedSide) {
    throw new Error(
      `direct contract method ${contractMethod} is inconsistent with side ${side}; expected ${expectedSide}`,
    );
  }
}

function validateExecutor(input: BuildInput, deps: ResolvedBuildDeps): void {
  if (!Object.values(Executors).includes(input.executorType)) {
    throw new Error(`unsupported executor type: ${input.executorType}`);
  }

  const builderAddress =
    deps.encodingContext.executorsAddresses[input.executorType].toLowerCase();

  if (input.executorAddress !== builderAddress) {
    throw new Error(
      `executor address mismatch: input ${input.executorAddress}, builder ${builderAddress}`,
    );
  }
}

function validateEncodingContext(
  input: BuildInput,
  deps: ResolvedBuildDeps,
): void {
  const { encodingContext } = deps;

  if (input.network !== encodingContext.network) {
    throw new Error(
      `network mismatch: input ${input.network}, context ${encodingContext.network}`,
    );
  }

  if (input.augustusV6Address !== encodingContext.augustusV6Address) {
    throw new Error(
      `augustusV6Address mismatch: input ${input.augustusV6Address}, context ${encodingContext.augustusV6Address}`,
    );
  }

  if (
    input.wrappedNativeTokenAddress !==
    encodingContext.wrappedNativeTokenAddress
  ) {
    throw new Error(
      `wrappedNativeTokenAddress mismatch: input ${input.wrappedNativeTokenAddress}, context ${encodingContext.wrappedNativeTokenAddress}`,
    );
  }
}

function validateTopLevelFields(input: BuildInput): void {
  assertLowercaseAddress(input.executorAddress, 'executorAddress');
  assertLowercaseAddress(input.augustusV6Address, 'augustusV6Address');
  assertLowercaseAddress(
    input.wrappedNativeTokenAddress,
    'wrappedNativeTokenAddress',
  );
  assertLowercaseAddress(input.srcToken, 'srcToken');
  assertLowercaseAddress(input.destToken, 'destToken');
  assertLowercaseAddress(input.userAddress, 'userAddress');
  assertLowercaseAddress(input.beneficiary, 'beneficiary');
  assertLowercaseAddress(input.fee.partnerAddress, 'fee.partnerAddress');

  if (input.fee.referrerAddress !== undefined) {
    assertLowercaseAddress(input.fee.referrerAddress, 'fee.referrerAddress');
  }

  assertDecimalAmountString(input.srcAmount, 'srcAmount');
  assertDecimalAmountString(input.destAmount, 'destAmount');
  assertDecimalAmountString(input.minMaxAmount, 'minMaxAmount');
  assertDecimalAmountString(input.quotedAmount, 'quotedAmount');
  assertDecimalAmountString(
    input.fee.partnerFeePercent,
    'fee.partnerFeePercent',
  );
  assertHexBytes(input.permit, 'permit');

  if (input.gas?.gasPrice !== undefined) {
    assertDecimalAmountString(input.gas.gasPrice, 'gas.gasPrice');
  }

  if (input.gas?.maxFeePerGas !== undefined) {
    assertDecimalAmountString(input.gas.maxFeePerGas, 'gas.maxFeePerGas');
  }

  if (input.gas?.maxPriorityFeePerGas !== undefined) {
    assertDecimalAmountString(
      input.gas.maxPriorityFeePerGas,
      'gas.maxPriorityFeePerGas',
    );
  }
}

function validateDirectTopLevelFields(input: DirectBuildInput): void {
  if (!Array.isArray(input.params)) {
    throw new Error('direct params must be an array');
  }

  assertLowercaseAddress(input.userAddress, 'userAddress');
  assertLowercaseAddress(input.augustusV6Address, 'augustusV6Address');
  assertLowercaseAddress(input.srcToken, 'srcToken');
  assertDecimalAmountString(input.srcAmount, 'srcAmount');
  assertDecimalAmountString(input.minMaxAmount, 'minMaxAmount');

  if (input.gas?.gasPrice !== undefined) {
    assertDecimalAmountString(input.gas.gasPrice, 'gas.gasPrice');
  }

  if (input.gas?.maxFeePerGas !== undefined) {
    assertDecimalAmountString(input.gas.maxFeePerGas, 'gas.maxFeePerGas');
  }

  if (input.gas?.maxPriorityFeePerGas !== undefined) {
    assertDecimalAmountString(
      input.gas.maxPriorityFeePerGas,
      'gas.maxPriorityFeePerGas',
    );
  }
}

function validateRoutePlan(routePlan: RoutePlan): void {
  routePlan.routes.forEach((route, routeIndex) => {
    route.swaps.forEach((swap, swapIndex) => {
      const swapPrefix = `routePlan.routes[${routeIndex}].swaps[${swapIndex}]`;

      assertLowercaseAddress(swap.srcToken, `${swapPrefix}.srcToken`);
      assertLowercaseAddress(swap.destToken, `${swapPrefix}.destToken`);
      assertDecimalAmountString(swap.srcAmount, `${swapPrefix}.srcAmount`);
      assertDecimalAmountString(swap.destAmount, `${swapPrefix}.destAmount`);

      swap.swapExchanges.forEach((swapExchange, swapExchangeIndex) => {
        const exchangePrefix = `${swapPrefix}.swapExchanges[${swapExchangeIndex}]`;

        assertDecimalAmountString(
          swapExchange.srcAmount,
          `${exchangePrefix}.srcAmount`,
        );
        assertDecimalAmountString(
          swapExchange.destAmount,
          `${exchangePrefix}.destAmount`,
        );
      });
    });
  });
}

function validateResolvedLeg(resolvedLeg: ResolvedLeg, index: number): void {
  const prefix = `resolvedLegs[${index}]`;

  assertLowercaseAddress(
    resolvedLeg.normalizedSrcToken,
    `${prefix}.normalizedSrcToken`,
  );
  assertLowercaseAddress(
    resolvedLeg.normalizedDestToken,
    `${prefix}.normalizedDestToken`,
  );
  assertLowercaseAddress(resolvedLeg.recipient, `${prefix}.recipient`);
  assertDecimalAmountString(
    resolvedLeg.normalizedSrcAmount,
    `${prefix}.normalizedSrcAmount`,
  );
  assertDecimalAmountString(
    resolvedLeg.normalizedDestAmount,
    `${prefix}.normalizedDestAmount`,
  );
  validateExchangeParam(resolvedLeg.exchangeParam, `${prefix}.exchangeParam`);
}

function validateExchangeParam(
  exchangeParam: DexExchangeBuildParam,
  prefix: string,
): void {
  if (typeof exchangeParam.needWrapNative !== 'boolean') {
    throw new Error(`${prefix}.needWrapNative must be boolean`);
  }

  assertLowercaseAddress(
    exchangeParam.targetExchange,
    `${prefix}.targetExchange`,
  );
  assertHexBytes(exchangeParam.exchangeData, `${prefix}.exchangeData`);

  if (exchangeParam.wethAddress !== undefined) {
    assertLowercaseAddress(exchangeParam.wethAddress, `${prefix}.wethAddress`);
  }

  if (exchangeParam.transferSrcTokenBeforeSwap !== undefined) {
    assertLowercaseAddress(
      exchangeParam.transferSrcTokenBeforeSwap,
      `${prefix}.transferSrcTokenBeforeSwap`,
    );
  }

  if (exchangeParam.spender !== undefined) {
    assertLowercaseAddress(exchangeParam.spender, `${prefix}.spender`);
  }

  if (exchangeParam.approveData !== undefined) {
    assertLowercaseAddress(
      exchangeParam.approveData.token,
      `${prefix}.approveData.token`,
    );
    assertLowercaseAddress(
      exchangeParam.approveData.target,
      `${prefix}.approveData.target`,
    );
  }
}

function validateWethPlan(input: BuildInput): void {
  if (!input.wethPlan) return;

  if (input.wethPlan.deposit !== undefined) {
    assertLowercaseAddress(
      input.wethPlan.deposit.callee,
      'wethPlan.deposit.callee',
    );
    assertHexBytes(
      input.wethPlan.deposit.calldata,
      'wethPlan.deposit.calldata',
    );
    assertDecimalAmountString(
      input.wethPlan.deposit.value,
      'wethPlan.deposit.value',
    );
  }

  if (input.wethPlan.withdraw !== undefined) {
    assertLowercaseAddress(
      input.wethPlan.withdraw.callee,
      'wethPlan.withdraw.callee',
    );
    assertHexBytes(
      input.wethPlan.withdraw.calldata,
      'wethPlan.withdraw.calldata',
    );
    assertDecimalAmountString(
      input.wethPlan.withdraw.value,
      'wethPlan.withdraw.value',
    );
  }
}

function buildGenericSwapParams(
  input: BuildInput,
  bytecode: string,
): (string | string[])[] {
  const isSell = input.side === SwapSide.SELL;
  const partnerAndFee = buildFeesV6(input.fee);

  return [
    input.executorAddress,
    [
      input.srcToken,
      input.destToken,
      isSell ? input.srcAmount : input.minMaxAmount,
      isSell ? input.minMaxAmount : input.destAmount,
      input.quotedAmount,
      hexConcat([
        hexZeroPad(uuidToBytes16(input.uuid), 16),
        hexZeroPad(hexlify(input.blockNumber), 16),
      ]),
      input.beneficiary,
    ],
    partnerAndFee,
    input.permit,
    bytecode,
  ];
}

function buildTxObject(
  input: BuildInput,
  params: (string | string[])[],
  augustusV6Interface: Interface,
): TxObject {
  // Boundary validation requires lowercase addresses before this ETH check.
  const value = (
    input.srcToken === ETHER_ADDRESS
      ? BigInt(
          input.side === SwapSide.SELL ? input.srcAmount : input.minMaxAmount,
        )
      : BigInt(0)
  ).toString();

  return {
    from: input.userAddress,
    to: input.augustusV6Address,
    value,
    data: augustusV6Interface.encodeFunctionData(input.contractMethod, params),
    gasPrice: input.gas?.gasPrice,
    maxFeePerGas: input.gas?.maxFeePerGas,
    maxPriorityFeePerGas: input.gas?.maxPriorityFeePerGas,
  };
}

function buildDirectTxObject(
  input: DirectBuildInput,
  params: unknown[],
  augustusV6Interface: Interface,
): TxObject {
  // Boundary validation requires lowercase addresses before this ETH check.
  const value = (
    input.srcToken === ETHER_ADDRESS
      ? BigInt(
          input.side === SwapSide.SELL ? input.srcAmount : input.minMaxAmount,
        )
      : BigInt(0)
  ).toString();

  return {
    from: input.userAddress,
    to: input.augustusV6Address,
    value,
    data: augustusV6Interface.encodeFunctionData(input.contractMethod, params),
    gasPrice: input.gas?.gasPrice,
    maxFeePerGas: input.gas?.maxFeePerGas,
    maxPriorityFeePerGas: input.gas?.maxPriorityFeePerGas,
  };
}

function buildFeesV6(fee: FeeInput): string {
  return fee.referrerAddress
    ? packPartnerAndFeeData({
        partner: fee.referrerAddress,
        feePercent: '0',
        isTakeSurplus: fee.takeSurplus,
        isCapSurplus: fee.isCapSurplus,
        isSurplusToUser: fee.isSurplusToUser,
        isDirectFeeTransfer: fee.isDirectFeeTransfer,
        isReferral: true,
        isSkipBlacklist: fee.isSkipBlacklist ?? false,
      })
    : packPartnerAndFeeData({
        partner: fee.partnerAddress,
        feePercent: fee.partnerFeePercent,
        isTakeSurplus: fee.takeSurplus,
        isCapSurplus: fee.isCapSurplus,
        isSurplusToUser: fee.isSurplusToUser,
        isDirectFeeTransfer: fee.isDirectFeeTransfer,
        isSkipBlacklist: fee.isSkipBlacklist ?? false,
        isReferral: false,
      });
}

function packPartnerAndFeeData({
  partner,
  feePercent,
  isTakeSurplus,
  isCapSurplus,
  isSurplusToUser,
  isDirectFeeTransfer,
  isReferral,
  isSkipBlacklist,
}: FeeParams): string {
  const partnerAddress =
    feePercent === '0' && !isTakeSurplus && !isReferral
      ? NULL_ADDRESS
      : partner;

  const partialFeeCodeWithPartnerAddress =
    BigNumber.from(partnerAddress).shl(96);
  let partialFeeCodeWithBitFlags = BigNumber.from(0);

  const isFixedFees = !BigNumber.from(feePercent).isZero();

  if (isFixedFees) {
    partialFeeCodeWithBitFlags = BigNumber.from(feePercent).and(
      FEE_PERCENT_IN_BASIS_POINTS_MASK,
    );
  } else {
    if (isTakeSurplus) {
      partialFeeCodeWithBitFlags =
        partialFeeCodeWithBitFlags.or(IS_TAKE_SURPLUS_MASK);
    } else if (isReferral) {
      partialFeeCodeWithBitFlags =
        partialFeeCodeWithBitFlags.or(IS_REFERRAL_MASK);
    }
  }

  if (isSkipBlacklist) {
    partialFeeCodeWithBitFlags = partialFeeCodeWithBitFlags.or(
      IS_SKIP_BLACKLIST_MASK,
    );
  }

  if (isCapSurplus) {
    partialFeeCodeWithBitFlags =
      partialFeeCodeWithBitFlags.or(IS_CAP_SURPLUS_MASK);
  }

  if (isSurplusToUser) {
    partialFeeCodeWithBitFlags =
      partialFeeCodeWithBitFlags.or(IS_USER_SURPLUS_MASK);
  }

  if (isDirectFeeTransfer) {
    partialFeeCodeWithBitFlags = partialFeeCodeWithBitFlags.or(
      IS_DIRECT_TRANSFER_MASK,
    );
  }

  return partialFeeCodeWithPartnerAddress
    .or(partialFeeCodeWithBitFlags)
    .toString();
}
