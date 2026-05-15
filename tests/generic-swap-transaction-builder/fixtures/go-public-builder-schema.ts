import type { BuildInput } from '../../../src/generic-swap-transaction-builder/resolved';
import type {
  DexExchangeParam,
  DexParamInput,
  NeedWrapNativeInput,
} from '../../../src/generic-swap-transaction-builder/dex-encoder';
import type { Address, TxObject } from '../../../src/types';
import { stableStringify } from '../canonical-json';

export { stableStringify };

export const GO_PUBLIC_BUILDER_SCHEMA_VERSION = 1;

export type BuildRequestJson = {
  priceRoute: PriceRouteJson;
  minMaxAmount: string;
  quotedAmount?: string;
  userAddress: Address;
  referrerAddress?: Address;
  partnerAddress: Address;
  partnerFeePercent: string;
  takeSurplus: boolean;
  isCapSurplus?: boolean;
  isSurplusToUser: boolean;
  isDirectFeeTransfer: boolean;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  permit?: string;
  deadline: string;
  uuid: string;
  beneficiary?: Address;
};

export type PriceRouteJson = {
  network: number;
  blockNumber: number;
  contractMethod: string;
  side: string;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  bestRoute: PriceRouteRouteJson[];
};

export type PriceRouteRouteJson = {
  percent: number;
  swaps: PriceRouteSwapJson[];
};

export type PriceRouteSwapJson = {
  srcToken: Address;
  destToken: Address;
  srcAmount?: string;
  destAmount?: string;
  swapExchanges: PriceRouteSwapExchangeJson[];
};

export type PriceRouteSwapExchangeJson = {
  exchange: string;
  percent: number;
  srcAmount: string;
  destAmount: string;
  data?: unknown;
};

export type GoPublicBuilderFixture = {
  schemaVersion: typeof GO_PUBLIC_BUILDER_SCHEMA_VERSION;
  name: string;
  description: string;
  kind: 'generic-public';
  dexKeys: string[];
  input: {
    request: BuildRequestJson;
    options: {
      skipApprovalCheck: boolean;
    };
  };
  expectedDexCalls: ExpectedDexCallJson[];
  expectedApprovalRequests: ExpectedApprovalRequestJson[];
  approvalDecisions: boolean[];
  expectedResolvedInput: BuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
};

export type ExpectedDexCallJson = {
  routePositionKey: string;
  dexKey: string;
  needWrapNativeInput: NeedWrapNativeInput;
  needWrapNative: boolean;
  dexParamInput: DexParamInput;
  dexParam: DexExchangeParam;
};

export type ExpectedApprovalRequestJson = {
  routePositionKey: string;
  token: Address;
  target: Address;
  permit2: boolean;
};

const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const DECIMAL_AMOUNT_RE = /^(0|[1-9][0-9]*)$/;
const HEX_RE = /^0x(?:[0-9a-f]{2})*$/;
const ROUTE_POSITION_KEY_RE = /^[0-9]+:[0-9]+:[0-9]+$/;

export function validateGoPublicBuilderFixture(
  fixture: unknown,
  source = '<fixture>',
): asserts fixture is GoPublicBuilderFixture {
  assertRecord(fixture, source);

  if (fixture.schemaVersion !== GO_PUBLIC_BUILDER_SCHEMA_VERSION) {
    throw new Error(
      `${source}: unsupported schemaVersion ${String(
        fixture.schemaVersion,
      )}; expected ${GO_PUBLIC_BUILDER_SCHEMA_VERSION}`,
    );
  }

  assertNonEmptyString(fixture.name, `${source}.name`);
  assertNonEmptyString(fixture.description, `${source}.description`);

  if (fixture.kind !== 'generic-public') {
    throw new Error(`${source}: unsupported kind ${String(fixture.kind)}`);
  }

  if (!Array.isArray(fixture.dexKeys) || fixture.dexKeys.length === 0) {
    throw new Error(`${source}.dexKeys must be a non-empty array`);
  }
  fixture.dexKeys.forEach((dexKey, index) =>
    assertNonEmptyString(dexKey, `${source}.dexKeys[${index}]`),
  );

  assertRecord(fixture.input, `${source}.input`);
  assertRecord(fixture.input.options, `${source}.input.options`);
  if (typeof fixture.input.options.skipApprovalCheck !== 'boolean') {
    throw new Error(
      `${source}.input.options.skipApprovalCheck must be boolean`,
    );
  }
  validateBuildRequest(fixture.input.request, `${source}.input.request`);

  if (!Array.isArray(fixture.expectedDexCalls)) {
    throw new Error(`${source}.expectedDexCalls must be an array`);
  }
  fixture.expectedDexCalls.forEach((call, index) =>
    validateExpectedDexCall(call, `${source}.expectedDexCalls[${index}]`),
  );

  if (!Array.isArray(fixture.expectedApprovalRequests)) {
    throw new Error(`${source}.expectedApprovalRequests must be an array`);
  }
  fixture.expectedApprovalRequests.forEach((request, index) =>
    validateExpectedApprovalRequest(
      request,
      `${source}.expectedApprovalRequests[${index}]`,
    ),
  );

  if (!Array.isArray(fixture.approvalDecisions)) {
    throw new Error(`${source}.approvalDecisions must be an array`);
  }
  fixture.approvalDecisions.forEach((decision, index) =>
    assertBoolean(decision, `${source}.approvalDecisions[${index}]`),
  );
  if (
    fixture.approvalDecisions.length !== fixture.expectedApprovalRequests.length
  ) {
    throw new Error(
      `${source}.approvalDecisions length must match expectedApprovalRequests length`,
    );
  }

  validateExpectedResolvedInput(
    fixture.expectedResolvedInput,
    `${source}.expectedResolvedInput`,
  );
  if (!Array.isArray(fixture.expectedParams)) {
    throw new Error(`${source}.expectedParams must be an array`);
  }
  validateExpectedTx(fixture.expectedTx, `${source}.expectedTx`);
}

function validateExpectedDexCall(value: unknown, source: string): void {
  assertRecord(value, source);
  assertRoutePositionKey(value.routePositionKey, `${source}.routePositionKey`);
  assertNonEmptyString(value.dexKey, `${source}.dexKey`);
  validateNeedWrapNativeInput(
    value.needWrapNativeInput,
    `${source}.needWrapNativeInput`,
  );
  assertBoolean(value.needWrapNative, `${source}.needWrapNative`);
  validateDexParamInput(value.dexParamInput, `${source}.dexParamInput`);
  validateExchangeParam(value.dexParam, `${source}.dexParam`);
  assertRecord(value.dexParam, `${source}.dexParam`);
  if (value.dexParam.needWrapNative !== value.needWrapNative) {
    throw new Error(
      `${source}.dexParam.needWrapNative must match ${source}.needWrapNative`,
    );
  }
}

function validateExpectedApprovalRequest(value: unknown, source: string): void {
  assertRecord(value, source);
  assertRoutePositionKey(value.routePositionKey, `${source}.routePositionKey`);
  assertAddress(value.token, `${source}.token`);
  assertAddress(value.target, `${source}.target`);
  assertBoolean(value.permit2, `${source}.permit2`);
}

function validateNeedWrapNativeInput(value: unknown, source: string): void {
  assertRecord(value, source);
  assertRecord(value.route, `${source}.route`);
  assertInteger(value.route.network, `${source}.route.network`);
  assertSwapSide(value.route.side, `${source}.route.side`);
  assertInteger(value.route.routeIndex, `${source}.route.routeIndex`);
  assertNumber(value.route.routePercent, `${source}.route.routePercent`);
  assertInteger(value.route.blockNumber, `${source}.route.blockNumber`);
  assertAddress(value.route.srcToken, `${source}.route.srcToken`);
  assertAddress(value.route.destToken, `${source}.route.destToken`);
  assertDecimalAmount(value.route.srcAmount, `${source}.route.srcAmount`);
  assertDecimalAmount(value.route.destAmount, `${source}.route.destAmount`);

  assertRecord(value.swap, `${source}.swap`);
  assertInteger(value.swap.swapIndex, `${source}.swap.swapIndex`);
  assertAddress(value.swap.srcToken, `${source}.swap.srcToken`);
  assertAddress(value.swap.destToken, `${source}.swap.destToken`);
  assertDecimalAmount(value.swap.srcAmount, `${source}.swap.srcAmount`);
  assertDecimalAmount(value.swap.destAmount, `${source}.swap.destAmount`);

  assertRecord(value.swapExchange, `${source}.swapExchange`);
  assertInteger(
    value.swapExchange.swapExchangeIndex,
    `${source}.swapExchange.swapExchangeIndex`,
  );
  assertNonEmptyString(
    value.swapExchange.exchange,
    `${source}.swapExchange.exchange`,
  );
  assertNumber(value.swapExchange.percent, `${source}.swapExchange.percent`);
  assertDecimalAmount(
    value.swapExchange.srcAmount,
    `${source}.swapExchange.srcAmount`,
  );
  assertDecimalAmount(
    value.swapExchange.destAmount,
    `${source}.swapExchange.destAmount`,
  );
}

function validateDexParamInput(value: unknown, source: string): void {
  validateNeedWrapNativeInput(value, source);
  const record = value as Record<string, any>;
  assertNonEmptyString(record.dexKey, `${source}.dexKey`);
  assertAddress(record.srcToken, `${source}.srcToken`);
  assertAddress(record.destToken, `${source}.destToken`);
  assertDecimalAmount(record.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(record.destAmount, `${source}.destAmount`);
  assertAddress(record.recipient, `${source}.recipient`);
  assertAddress(record.executorAddress, `${source}.executorAddress`);
  assertSwapSide(record.side, `${source}.side`);
}

function validateBuildRequest(value: unknown, source: string): void {
  assertRecord(value, source);
  validatePriceRoute(value.priceRoute, `${source}.priceRoute`);
  assertDecimalAmount(value.minMaxAmount, `${source}.minMaxAmount`);
  if (value.quotedAmount !== undefined) {
    assertDecimalAmountOrEmpty(value.quotedAmount, `${source}.quotedAmount`);
  }
  assertAddress(value.userAddress, `${source}.userAddress`);
  if (value.referrerAddress !== undefined) {
    assertAddress(value.referrerAddress, `${source}.referrerAddress`);
  }
  assertAddress(value.partnerAddress, `${source}.partnerAddress`);
  assertDecimalAmount(value.partnerFeePercent, `${source}.partnerFeePercent`);
  assertBoolean(value.takeSurplus, `${source}.takeSurplus`);
  if (value.isCapSurplus !== undefined) {
    assertBoolean(value.isCapSurplus, `${source}.isCapSurplus`);
  }
  assertBoolean(value.isSurplusToUser, `${source}.isSurplusToUser`);
  assertBoolean(value.isDirectFeeTransfer, `${source}.isDirectFeeTransfer`);
  if (value.gasPrice !== undefined) {
    assertDecimalAmount(value.gasPrice, `${source}.gasPrice`);
  }
  if (value.maxFeePerGas !== undefined) {
    assertDecimalAmount(value.maxFeePerGas, `${source}.maxFeePerGas`);
  }
  if (value.maxPriorityFeePerGas !== undefined) {
    assertDecimalAmount(
      value.maxPriorityFeePerGas,
      `${source}.maxPriorityFeePerGas`,
    );
  }
  if (value.permit !== undefined) {
    assertHex(value.permit, `${source}.permit`);
  }
  assertDecimalAmount(value.deadline, `${source}.deadline`);
  assertNonEmptyString(value.uuid, `${source}.uuid`);
  if (value.beneficiary !== undefined) {
    assertAddress(value.beneficiary, `${source}.beneficiary`);
  }
}

function validatePriceRoute(value: unknown, source: string): void {
  assertRecord(value, source);
  assertInteger(value.network, `${source}.network`);
  assertInteger(value.blockNumber, `${source}.blockNumber`);
  assertNonEmptyString(value.contractMethod, `${source}.contractMethod`);
  assertSwapSide(value.side, `${source}.side`);
  assertAddress(value.srcToken, `${source}.srcToken`);
  assertAddress(value.destToken, `${source}.destToken`);
  assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(value.destAmount, `${source}.destAmount`);
  if (!Array.isArray(value.bestRoute)) {
    throw new Error(`${source}.bestRoute must be an array`);
  }
  value.bestRoute.forEach((route, routeIndex) => {
    assertRecord(route, `${source}.bestRoute[${routeIndex}]`);
    assertNumber(route.percent, `${source}.bestRoute[${routeIndex}].percent`);
    if (!Array.isArray(route.swaps)) {
      throw new Error(
        `${source}.bestRoute[${routeIndex}].swaps must be an array`,
      );
    }
    route.swaps.forEach((swap, swapIndex) =>
      validateSwap(
        swap,
        `${source}.bestRoute[${routeIndex}].swaps[${swapIndex}]`,
      ),
    );
  });
}

function validateSwap(value: unknown, source: string): void {
  assertRecord(value, source);
  assertAddress(value.srcToken, `${source}.srcToken`);
  assertAddress(value.destToken, `${source}.destToken`);
  if (value.srcAmount !== undefined) {
    assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  }
  if (value.destAmount !== undefined) {
    assertDecimalAmount(value.destAmount, `${source}.destAmount`);
  }
  if (!Array.isArray(value.swapExchanges)) {
    throw new Error(`${source}.swapExchanges must be an array`);
  }
  value.swapExchanges.forEach((swapExchange, swapExchangeIndex) => {
    const exchangeSource = `${source}.swapExchanges[${swapExchangeIndex}]`;
    assertRecord(swapExchange, exchangeSource);
    assertNonEmptyString(swapExchange.exchange, `${exchangeSource}.exchange`);
    assertNumber(swapExchange.percent, `${exchangeSource}.percent`);
    assertDecimalAmount(swapExchange.srcAmount, `${exchangeSource}.srcAmount`);
    assertDecimalAmount(
      swapExchange.destAmount,
      `${exchangeSource}.destAmount`,
    );
  });
}

function validateExpectedResolvedInput(value: unknown, source: string): void {
  assertRecord(value, source);
  validateResolvedRoutePlan(value.routePlan, `${source}.routePlan`);
  if (!Array.isArray(value.resolvedLegs)) {
    throw new Error(`${source}.resolvedLegs must be an array`);
  }
  value.resolvedLegs.forEach((leg, index) =>
    validateResolvedLeg(leg, `${source}.resolvedLegs[${index}]`),
  );

  assertNonEmptyString(value.executorType, `${source}.executorType`);
  assertAddress(value.executorAddress, `${source}.executorAddress`);
  assertAddress(value.augustusV6Address, `${source}.augustusV6Address`);
  assertAddress(
    value.wrappedNativeTokenAddress,
    `${source}.wrappedNativeTokenAddress`,
  );
  assertInteger(value.network, `${source}.network`);
  assertAddress(value.srcToken, `${source}.srcToken`);
  assertAddress(value.destToken, `${source}.destToken`);
  assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(value.destAmount, `${source}.destAmount`);
  assertDecimalAmount(value.minMaxAmount, `${source}.minMaxAmount`);
  assertDecimalAmount(value.quotedAmount, `${source}.quotedAmount`);
  assertSwapSide(value.side, `${source}.side`);
  assertNonEmptyString(value.contractMethod, `${source}.contractMethod`);
  assertInteger(value.blockNumber, `${source}.blockNumber`);
  assertAddress(value.userAddress, `${source}.userAddress`);
  assertAddress(value.beneficiary, `${source}.beneficiary`);
  assertHex(value.permit, `${source}.permit`);
  assertNonEmptyString(value.uuid, `${source}.uuid`);
  validateExpectedFee(value.fee, `${source}.fee`);

  if (value.gas !== undefined) {
    assertRecord(value.gas, `${source}.gas`);
    if (value.gas.gasPrice !== undefined) {
      assertDecimalAmount(value.gas.gasPrice, `${source}.gas.gasPrice`);
    }
    if (value.gas.maxFeePerGas !== undefined) {
      assertDecimalAmount(value.gas.maxFeePerGas, `${source}.gas.maxFeePerGas`);
    }
    if (value.gas.maxPriorityFeePerGas !== undefined) {
      assertDecimalAmount(
        value.gas.maxPriorityFeePerGas,
        `${source}.gas.maxPriorityFeePerGas`,
      );
    }
  }
}

function validateResolvedRoutePlan(value: unknown, source: string): void {
  assertRecord(value, source);
  if (!Array.isArray(value.routes)) {
    throw new Error(`${source}.routes must be an array`);
  }
  value.routes.forEach((route, routeIndex) => {
    assertRecord(route, `${source}.routes[${routeIndex}]`);
    assertNumber(route.percent, `${source}.routes[${routeIndex}].percent`);
    if (!Array.isArray(route.swaps)) {
      throw new Error(`${source}.routes[${routeIndex}].swaps must be an array`);
    }
    route.swaps.forEach((swap, swapIndex) => {
      const swapSource = `${source}.routes[${routeIndex}].swaps[${swapIndex}]`;
      validateResolvedSwap(swap, swapSource);
    });
  });
}

function validateResolvedSwap(value: unknown, source: string): void {
  assertRecord(value, source);
  assertAddress(value.srcToken, `${source}.srcToken`);
  assertAddress(value.destToken, `${source}.destToken`);
  assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(value.destAmount, `${source}.destAmount`);
  if (!Array.isArray(value.swapExchanges)) {
    throw new Error(`${source}.swapExchanges must be an array`);
  }
  value.swapExchanges.forEach((swapExchange, index) => {
    const exchangeSource = `${source}.swapExchanges[${index}]`;
    assertRecord(swapExchange, exchangeSource);
    assertNonEmptyString(swapExchange.exchange, `${exchangeSource}.exchange`);
    assertNumber(swapExchange.percent, `${exchangeSource}.percent`);
    assertDecimalAmount(swapExchange.srcAmount, `${exchangeSource}.srcAmount`);
    assertDecimalAmount(
      swapExchange.destAmount,
      `${exchangeSource}.destAmount`,
    );
  });
}

function validateResolvedLeg(value: unknown, source: string): void {
  assertRecord(value, source);
  assertInteger(value.routeIndex, `${source}.routeIndex`);
  assertInteger(value.swapIndex, `${source}.swapIndex`);
  assertInteger(value.swapExchangeIndex, `${source}.swapExchangeIndex`);
  validateExchangeParam(value.exchangeParam, `${source}.exchangeParam`);
  assertAddress(value.normalizedSrcToken, `${source}.normalizedSrcToken`);
  assertAddress(value.normalizedDestToken, `${source}.normalizedDestToken`);
  assertDecimalAmount(
    value.normalizedSrcAmount,
    `${source}.normalizedSrcAmount`,
  );
  assertDecimalAmount(
    value.normalizedDestAmount,
    `${source}.normalizedDestAmount`,
  );
  assertAddress(value.recipient, `${source}.recipient`);
}

function validateExchangeParam(value: unknown, source: string): void {
  assertRecord(value, source);
  assertBoolean(value.needWrapNative, `${source}.needWrapNative`);
  if (value.needUnwrapNative !== undefined) {
    assertBoolean(value.needUnwrapNative, `${source}.needUnwrapNative`);
  }
  if (value.skipApproval !== undefined) {
    assertBoolean(value.skipApproval, `${source}.skipApproval`);
  }
  if (value.wethAddress !== undefined) {
    assertAddress(value.wethAddress, `${source}.wethAddress`);
  }
  assertHex(value.exchangeData, `${source}.exchangeData`);
  assertAddress(value.targetExchange, `${source}.targetExchange`);
  assertBoolean(value.dexFuncHasRecipient, `${source}.dexFuncHasRecipient`);
  if (value.specialDexFlag !== undefined) {
    assertInteger(value.specialDexFlag, `${source}.specialDexFlag`);
  }
  if (value.transferSrcTokenBeforeSwap !== undefined) {
    assertAddress(
      value.transferSrcTokenBeforeSwap,
      `${source}.transferSrcTokenBeforeSwap`,
    );
  }
  if (value.spender !== undefined) {
    assertAddress(value.spender, `${source}.spender`);
  }
  [
    'sendEthButSupportsInsertFromAmount',
    'specialDexSupportsInsertFromAmount',
    'swappedAmountNotPresentInExchangeData',
    'amountsPacked128',
    'permit2Approval',
  ].forEach(field => {
    if (value[field] !== undefined) {
      assertBoolean(value[field], `${source}.${field}`);
    }
  });
  ['returnAmountPos', 'insertFromAmountPos'].forEach(field => {
    if (value[field] !== undefined) {
      assertInteger(value[field], `${source}.${field}`);
    }
  });
  if (value.approveData !== undefined) {
    assertRecord(value.approveData, `${source}.approveData`);
    assertAddress(value.approveData.token, `${source}.approveData.token`);
    assertAddress(value.approveData.target, `${source}.approveData.target`);
  }
}

function validateExpectedFee(value: unknown, source: string): void {
  assertRecord(value, source);
  assertAddress(value.partnerAddress, `${source}.partnerAddress`);
  assertDecimalAmount(value.partnerFeePercent, `${source}.partnerFeePercent`);
  if (value.referrerAddress !== undefined) {
    assertAddress(value.referrerAddress, `${source}.referrerAddress`);
  }
  assertBoolean(value.takeSurplus, `${source}.takeSurplus`);
  assertBoolean(value.isCapSurplus, `${source}.isCapSurplus`);
  assertBoolean(value.isSurplusToUser, `${source}.isSurplusToUser`);
  assertBoolean(value.isDirectFeeTransfer, `${source}.isDirectFeeTransfer`);
  if (value.isSkipBlacklist !== undefined) {
    assertBoolean(value.isSkipBlacklist, `${source}.isSkipBlacklist`);
  }
}

function validateExpectedTx(value: unknown, source: string): void {
  assertRecord(value, source);
  assertAddress(value.from, `${source}.from`);
  assertAddress(value.to, `${source}.to`);
  assertDecimalAmount(value.value, `${source}.value`);
  assertHex(value.data, `${source}.data`);
  if (value.gasPrice !== undefined) {
    assertDecimalAmount(value.gasPrice, `${source}.gasPrice`);
  }
  if (value.maxFeePerGas !== undefined) {
    assertDecimalAmount(value.maxFeePerGas, `${source}.maxFeePerGas`);
  }
  if (value.maxPriorityFeePerGas !== undefined) {
    assertDecimalAmount(
      value.maxPriorityFeePerGas,
      `${source}.maxPriorityFeePerGas`,
    );
  }
}

function assertRecord(
  value: unknown,
  source: string,
): asserts value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${source} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, source: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${source} must be a non-empty string`);
  }
}

function assertAddress(value: unknown, source: string): void {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new Error(`${source} must be a lowercase 42-character hex address`);
  }
}

function assertDecimalAmount(value: unknown, source: string): void {
  if (typeof value !== 'string' || !DECIMAL_AMOUNT_RE.test(value)) {
    throw new Error(`${source} must be a decimal string`);
  }
}

function assertDecimalAmountOrEmpty(value: unknown, source: string): void {
  if (
    typeof value !== 'string' ||
    (value !== '' && !DECIMAL_AMOUNT_RE.test(value))
  ) {
    throw new Error(`${source} must be an empty or decimal string`);
  }
}

function assertHex(value: unknown, source: string): void {
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    throw new Error(`${source} must be 0x-prefixed hex bytes`);
  }
}

function assertRoutePositionKey(value: unknown, source: string): void {
  if (typeof value !== 'string' || !ROUTE_POSITION_KEY_RE.test(value)) {
    throw new Error(`${source} must be a route-position key`);
  }
}

function assertInteger(value: unknown, source: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${source} must be an integer`);
  }
}

function assertNumber(value: unknown, source: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${source} must be a finite number`);
  }
}

function assertBoolean(value: unknown, source: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(`${source} must be boolean`);
  }
}

function assertSwapSide(value: unknown, source: string): void {
  if (value !== 'SELL' && value !== 'BUY') {
    throw new Error(`${source} must be SELL or BUY`);
  }
}
