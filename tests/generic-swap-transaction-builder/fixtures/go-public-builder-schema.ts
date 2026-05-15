import type { BuildInput } from '../../../src/generic-swap-transaction-builder/resolved';
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
  expectedResolvedInput: BuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
};

const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const DECIMAL_AMOUNT_RE = /^(0|[1-9][0-9]*)$/;
const HEX_RE = /^0x(?:[0-9a-f]{2})*$/;

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

  validateExpectedResolvedInput(
    fixture.expectedResolvedInput,
    `${source}.expectedResolvedInput`,
  );
  if (!Array.isArray(fixture.expectedParams)) {
    throw new Error(`${source}.expectedParams must be an array`);
  }
  validateExpectedTx(fixture.expectedTx, `${source}.expectedTx`);
}

function validateBuildRequest(value: unknown, source: string): void {
  assertRecord(value, source);
  validatePriceRoute(value.priceRoute, `${source}.priceRoute`);
  assertDecimalAmount(value.minMaxAmount, `${source}.minMaxAmount`);
  if (value.quotedAmount !== undefined) {
    assertDecimalAmount(value.quotedAmount, `${source}.quotedAmount`);
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

function assertHex(value: unknown, source: string): void {
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    throw new Error(`${source} must be 0x-prefixed hex bytes`);
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
