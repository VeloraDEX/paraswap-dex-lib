import { SwapSide } from '@paraswap/core';
import { SPECIAL_DEX_FLAG_RESERVED_RANGE } from '../../../src/generic-swap-transaction-builder/dex-encoder';
import {
  isDirectContractMethodV6,
  type DirectContractMethodV6,
} from '../../../src/generic-swap-transaction-builder/dex-encoder/direct-methods';
import type {
  DexExchangeParam,
  DexParamInput,
  DirectParamInput,
  DirectParamResult,
  NeedWrapNativeInput,
} from '../../../src/generic-swap-transaction-builder/dex-encoder/types';
import { stableStringify } from '../canonical-json';

export { stableStringify };

export const DEX_ENCODER_FIXTURE_SCHEMA_VERSION = 1;
// Schema bumps must include a fixture migration that rewrites every committed
// JSON fixture and updates the schema-version rejection test.

export const DEX_ENCODER_FIXTURE_KINDS = [
  'need-wrap-native',
  'dex-param',
  'direct-param',
] as const;

export type DexEncoderFixtureKind = (typeof DEX_ENCODER_FIXTURE_KINDS)[number];

export type NeedWrapNativeFixture = {
  schemaVersion: typeof DEX_ENCODER_FIXTURE_SCHEMA_VERSION;
  name: string;
  kind: 'need-wrap-native';
  description?: string;
  network: number;
  dexKey: string;
  input: NeedWrapNativeInput;
  expected: boolean;
};

export type DexParamFixture = {
  schemaVersion: typeof DEX_ENCODER_FIXTURE_SCHEMA_VERSION;
  name: string;
  kind: 'dex-param';
  description?: string;
  network: number;
  dexKey: string;
  input: DexParamInput;
  expected: DexExchangeParam;
};

export type DirectParamFixture = {
  schemaVersion: typeof DEX_ENCODER_FIXTURE_SCHEMA_VERSION;
  name: string;
  kind: 'direct-param';
  description?: string;
  network: number;
  dexKey: string;
  contractMethod: DirectContractMethodV6;
  input: DirectParamInput;
  expected: DirectParamResult;
};

export type DexEncoderFixture =
  | NeedWrapNativeFixture
  | DexParamFixture
  | DirectParamFixture;

const FIXTURE_KIND_SET = new Set<string>(DEX_ENCODER_FIXTURE_KINDS);
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const DECIMAL_AMOUNT_RE = /^(0|[1-9][0-9]*)$/;
const HEX_RE = /^0x(?:[0-9a-f]{2})*$/;

export function validateDexEncoderFixture(
  fixture: unknown,
  source = '<fixture>',
): asserts fixture is DexEncoderFixture {
  assertRecord(fixture, source);
  assertKnownKeys(
    fixture,
    [
      'schemaVersion',
      'name',
      'kind',
      'description',
      'network',
      'dexKey',
      'contractMethod',
      'input',
      'expected',
    ],
    source,
  );

  if (fixture.schemaVersion !== DEX_ENCODER_FIXTURE_SCHEMA_VERSION) {
    throw new Error(
      `${source}: unsupported schemaVersion ${String(
        fixture.schemaVersion,
      )}; expected ${DEX_ENCODER_FIXTURE_SCHEMA_VERSION}`,
    );
  }

  assertNonEmptyString(fixture.name, `${source}.name`);

  if (typeof fixture.kind !== 'string' || !FIXTURE_KIND_SET.has(fixture.kind)) {
    throw new Error(`${source}: unsupported kind ${String(fixture.kind)}`);
  }

  if (fixture.description !== undefined) {
    assertNonEmptyString(fixture.description, `${source}.description`);
  }

  assertInteger(fixture.network, `${source}.network`);
  assertNonEmptyString(fixture.dexKey, `${source}.dexKey`);

  if (fixture.kind !== 'direct-param' && fixture.contractMethod !== undefined) {
    throw new Error(
      `${source}: contractMethod is only allowed on direct-param`,
    );
  }

  if (fixture.kind === 'need-wrap-native') {
    validateNeedWrapNativeInput(fixture.input, `${source}.input`);
    validateDexSpecificData(
      fixture.dexKey,
      fixture.input.swapExchange.data,
      `${source}.input.swapExchange.data`,
    );

    if (typeof fixture.expected !== 'boolean') {
      throw new Error(`${source}.expected must be boolean`);
    }

    assertFixtureInputMetadata(fixture, fixture.input, source);
    return;
  }

  if (fixture.kind === 'dex-param') {
    validateDexParamInput(fixture.input, `${source}.input`);
    validateDexSpecificData(
      fixture.dexKey,
      fixture.input.swapExchange.data,
      `${source}.input.swapExchange.data`,
    );
    validateDexSpecificData(
      fixture.dexKey,
      fixture.input.data,
      `${source}.input.data`,
    );
    validateDexExchangeParam(fixture.expected, `${source}.expected`);
    assertFixtureInputMetadata(fixture, fixture.input, source);
    return;
  }

  if (!isDirectContractMethodV6(fixture.contractMethod)) {
    throw new Error(
      `${source}.contractMethod is not a supported V6 direct method: ${String(
        fixture.contractMethod,
      )}`,
    );
  }

  validateDirectParamInput(fixture.input, `${source}.input`);
  validateDexSpecificData(
    fixture.dexKey,
    fixture.input.data,
    `${source}.input.data`,
  );
  validateDirectParamResult(fixture.expected, `${source}.expected`);
  assertFixtureInputMetadata(fixture, fixture.input, source);

  if (fixture.input.contractMethod !== fixture.contractMethod) {
    throw new Error(`${source}: input.contractMethod must match fixture`);
  }
}

function assertFixtureInputMetadata(
  fixture: Record<string, any>,
  input: any,
  source: string,
): void {
  const inputNetwork =
    input.network === undefined ? input.route?.network : input.network;

  if (inputNetwork !== fixture.network) {
    throw new Error(`${source}: input network must match fixture network`);
  }

  if (fixture.kind !== 'need-wrap-native' && input.dexKey !== fixture.dexKey) {
    throw new Error(`${source}: input dexKey must match fixture dexKey`);
  }

  if (
    (fixture.kind === 'need-wrap-native' || fixture.kind === 'dex-param') &&
    input.swapExchange.exchange !== fixture.dexKey
  ) {
    throw new Error(
      `${source}: input swapExchange.exchange must match fixture dexKey`,
    );
  }

  if (
    fixture.kind === 'dex-param' &&
    stableStringify(input.data) !== stableStringify(input.swapExchange.data)
  ) {
    throw new Error(`${source}: input.data must match input.swapExchange.data`);
  }
}

function validateNeedWrapNativeInput(
  input: unknown,
  source: string,
): asserts input is NeedWrapNativeInput {
  assertRecord(input, source);
  assertKnownKeys(input, ['route', 'swap', 'swapExchange'], source);
  validateNeedWrapNativeRoute(input.route, `${source}.route`);
  validateNeedWrapNativeSwap(input.swap, `${source}.swap`);
  validateNeedWrapNativeSwapExchange(
    input.swapExchange,
    `${source}.swapExchange`,
  );
}

function validateNeedWrapNativeRoute(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    [
      'network',
      'side',
      'routeIndex',
      'routePercent',
      'blockNumber',
      'srcToken',
      'destToken',
      'srcAmount',
      'destAmount',
    ],
    source,
  );
  assertInteger(value.network, `${source}.network`);
  assertSwapSide(value.side, `${source}.side`);
  assertInteger(value.routeIndex, `${source}.routeIndex`);
  assertNumber(value.routePercent, `${source}.routePercent`);
  assertInteger(value.blockNumber, `${source}.blockNumber`);
  assertAddress(value.srcToken, `${source}.srcToken`);
  assertAddress(value.destToken, `${source}.destToken`);
  assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(value.destAmount, `${source}.destAmount`);
}

function validateNeedWrapNativeSwap(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    ['swapIndex', 'srcToken', 'destToken', 'srcAmount', 'destAmount'],
    source,
  );
  assertInteger(value.swapIndex, `${source}.swapIndex`);
  assertAddress(value.srcToken, `${source}.srcToken`);
  assertAddress(value.destToken, `${source}.destToken`);
  assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(value.destAmount, `${source}.destAmount`);
}

function validateNeedWrapNativeSwapExchange(
  value: unknown,
  source: string,
): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    [
      'swapExchangeIndex',
      'exchange',
      'srcAmount',
      'destAmount',
      'percent',
      'data',
    ],
    source,
  );
  assertInteger(value.swapExchangeIndex, `${source}.swapExchangeIndex`);
  assertNonEmptyString(value.exchange, `${source}.exchange`);
  assertDecimalAmount(value.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(value.destAmount, `${source}.destAmount`);
  assertNumber(value.percent, `${source}.percent`);
  assertJsonValue(value.data, `${source}.data`);
}

function validateDexParamInput(
  input: unknown,
  source: string,
): asserts input is DexParamInput {
  assertRecord(input, source);
  assertKnownKeys(
    input,
    [
      'route',
      'swap',
      'swapExchange',
      'dexKey',
      'srcToken',
      'destToken',
      'srcAmount',
      'destAmount',
      'recipient',
      'executorAddress',
      'side',
      'data',
    ],
    source,
  );
  validateNeedWrapNativeRoute(input.route, `${source}.route`);
  validateNeedWrapNativeSwap(input.swap, `${source}.swap`);
  validateNeedWrapNativeSwapExchange(
    input.swapExchange,
    `${source}.swapExchange`,
  );
  const dexInput = input as DexParamInput;

  assertNonEmptyString(dexInput.dexKey, `${source}.dexKey`);
  assertAddress(dexInput.srcToken, `${source}.srcToken`);
  assertAddress(dexInput.destToken, `${source}.destToken`);
  assertDecimalAmount(dexInput.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(dexInput.destAmount, `${source}.destAmount`);
  assertAddress(dexInput.recipient, `${source}.recipient`);
  assertAddress(dexInput.executorAddress, `${source}.executorAddress`);
  assertSwapSide(dexInput.side, `${source}.side`);
  assertJsonValue(dexInput.data, `${source}.data`);

  if (dexInput.side !== dexInput.route.side) {
    throw new Error(`${source}.side must match route.side`);
  }
}

function validateDexExchangeParam(
  value: unknown,
  source: string,
): asserts value is DexExchangeParam {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    [
      'needWrapNative',
      'needUnwrapNative',
      'skipApproval',
      'wethAddress',
      'exchangeData',
      'targetExchange',
      'dexFuncHasRecipient',
      'specialDexFlag',
      'transferSrcTokenBeforeSwap',
      'spender',
      'sendEthButSupportsInsertFromAmount',
      'specialDexSupportsInsertFromAmount',
      'swappedAmountNotPresentInExchangeData',
      'returnAmountPos',
      'insertFromAmountPos',
      'amountsPacked128',
      'permit2Approval',
    ],
    source,
  );
  assertBoolean(value.needWrapNative, `${source}.needWrapNative`);
  assertHex(value.exchangeData, `${source}.exchangeData`);
  assertAddress(value.targetExchange, `${source}.targetExchange`);
  assertBoolean(value.dexFuncHasRecipient, `${source}.dexFuncHasRecipient`);

  [
    'needUnwrapNative',
    'skipApproval',
    'sendEthButSupportsInsertFromAmount',
    'specialDexSupportsInsertFromAmount',
    'swappedAmountNotPresentInExchangeData',
    'amountsPacked128',
    'permit2Approval',
  ].forEach(field => assertOptionalBoolean(value[field], `${source}.${field}`));

  ['wethAddress', 'transferSrcTokenBeforeSwap', 'spender'].forEach(field =>
    assertOptionalAddress(value[field], `${source}.${field}`),
  );

  ['returnAmountPos', 'insertFromAmountPos'].forEach(field =>
    assertOptionalInteger(value[field], `${source}.${field}`),
  );

  if (value.specialDexFlag !== undefined) {
    assertInteger(value.specialDexFlag, `${source}.specialDexFlag`);

    if (
      value.specialDexFlag < SPECIAL_DEX_FLAG_RESERVED_RANGE.min ||
      value.specialDexFlag > SPECIAL_DEX_FLAG_RESERVED_RANGE.max
    ) {
      throw new Error(`${source}.specialDexFlag is outside reserved range`);
    }
  }
}

function validateDirectParamInput(
  input: unknown,
  source: string,
): asserts input is DirectParamInput {
  assertRecord(input, source);
  assertKnownKeys(
    input,
    [
      'dexKey',
      'network',
      'contractMethod',
      'srcToken',
      'destToken',
      'srcAmount',
      'destAmount',
      'quotedAmount',
      'data',
      'side',
      'permit',
      'uuid',
      'partnerAndFee',
      'beneficiary',
      'blockNumber',
    ],
    source,
  );
  assertNonEmptyString(input.dexKey, `${source}.dexKey`);
  assertInteger(input.network, `${source}.network`);

  if (!isDirectContractMethodV6(input.contractMethod)) {
    throw new Error(
      `${source}.contractMethod is not a supported V6 direct method: ${String(
        input.contractMethod,
      )}`,
    );
  }

  assertAddress(input.srcToken, `${source}.srcToken`);
  assertAddress(input.destToken, `${source}.destToken`);
  assertDecimalAmount(input.srcAmount, `${source}.srcAmount`);
  assertDecimalAmount(input.destAmount, `${source}.destAmount`);
  assertDecimalAmount(input.quotedAmount, `${source}.quotedAmount`);
  assertJsonValue(input.data, `${source}.data`);
  assertSwapSide(input.side, `${source}.side`);
  assertHex(input.permit, `${source}.permit`);
  assertNonEmptyString(input.uuid, `${source}.uuid`);
  assertDecimalAmount(input.partnerAndFee, `${source}.partnerAndFee`);
  assertAddress(input.beneficiary, `${source}.beneficiary`);
  assertInteger(input.blockNumber, `${source}.blockNumber`);
}

function validateDirectParamResult(
  value: unknown,
  source: string,
): asserts value is DirectParamResult {
  assertRecord(value, source);
  assertKnownKeys(value, ['params'], source);

  if (!Array.isArray(value.params)) {
    throw new Error(`${source}.params must be an array`);
  }

  assertJsonValue(value.params, `${source}.params`);
}

function validateDexSpecificData(
  dexKey: string,
  value: unknown,
  source: string,
): void {
  if (dexKey === 'UniswapV3' || dexKey === 'SushiSwapV3') {
    validateUniswapV3LikeData(value, source);
    return;
  }

  if (dexKey === 'BalancerV1') {
    validateBalancerV1Data(value, source);
    return;
  }

  if (dexKey === 'Weth') {
    if (value !== null) {
      throw new Error(`${source} must be null for Weth`);
    }
    return;
  }

  if (dexKey === 'tessera') {
    if (value !== null) {
      throw new Error(`${source} must be null for tessera`);
    }
    return;
  }

  if (dexKey === 'UniswapV2') {
    validateUniswapV2Data(value, source);
    return;
  }

  if (dexKey === 'BalancerV2') {
    validateBalancerV2Data(value, source);
    return;
  }

  if (dexKey === 'CurveV1') {
    validateCurveV1Data(value, source);
    return;
  }

  if (dexKey === 'CurveV2') {
    validateCurveV2Data(value, source);
    return;
  }

  if (dexKey === 'LitePsm') {
    validateLitePsmData(value, source);
    return;
  }

  if (dexKey === 'GenericRFQ') {
    validateGenericRfqData(value, source);
    return;
  }

  throw new Error(`${source}: unsupported DEX key ${dexKey}`);
}

function validateUniswapV3LikeData(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(value, ['path', 'gasUSD', 'isApproved'], source);
  assertOptionalString(value.gasUSD, `${source}.gasUSD`);
  assertOptionalBoolean(value.isApproved, `${source}.isApproved`);

  if (!Array.isArray(value.path) || value.path.length === 0) {
    throw new Error(`${source}.path must be a non-empty array`);
  }

  value.path.forEach((hop, index) => {
    assertRecord(hop, `${source}.path[${index}]`);
    assertKnownKeys(
      hop,
      ['tokenIn', 'tokenOut', 'fee', 'currentFee'],
      `${source}.path[${index}]`,
    );
    assertAddress(hop.tokenIn, `${source}.path[${index}].tokenIn`);
    assertAddress(hop.tokenOut, `${source}.path[${index}].tokenOut`);
    assertDecimalAmount(hop.fee, `${source}.path[${index}].fee`);

    if (hop.currentFee !== undefined) {
      assertDecimalAmount(
        hop.currentFee,
        `${source}.path[${index}].currentFee`,
      );
    }
  });
}

function validateBalancerV1Data(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(value, ['swaps', 'gasUSD'], source);
  assertOptionalString(value.gasUSD, `${source}.gasUSD`);

  if (!Array.isArray(value.swaps) || value.swaps.length === 0) {
    throw new Error(`${source}.swaps must be a non-empty array`);
  }

  value.swaps.forEach((swap, index) => {
    assertRecord(swap, `${source}.swaps[${index}]`);
    assertKnownKeys(
      swap,
      ['pool', 'tokenInParam', 'tokenOutParam', 'maxPrice'],
      `${source}.swaps[${index}]`,
    );
    assertAddress(swap.pool, `${source}.swaps[${index}].pool`);
    assertDecimalAmount(
      swap.tokenInParam,
      `${source}.swaps[${index}].tokenInParam`,
    );
    assertDecimalAmount(
      swap.tokenOutParam,
      `${source}.swaps[${index}].tokenOutParam`,
    );
    assertDecimalAmount(swap.maxPrice, `${source}.swaps[${index}].maxPrice`);
  });
}

function validateUniswapV2Data(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    [
      'router',
      'path',
      'pools',
      'factory',
      'initCode',
      'feeFactor',
      'wethAddress',
    ],
    source,
  );
  assertAddress(value.router, `${source}.router`);
  assertAddress(value.factory, `${source}.factory`);
  assertHex(value.initCode, `${source}.initCode`);
  assertInteger(value.feeFactor, `${source}.feeFactor`);
  assertOptionalAddress(value.wethAddress, `${source}.wethAddress`);

  if (!Array.isArray(value.path) || value.path.length < 2) {
    throw new Error(`${source}.path must contain at least two addresses`);
  }

  value.path.forEach((address, index) =>
    assertAddress(address, `${source}.path[${index}]`),
  );

  if (!Array.isArray(value.pools) || value.pools.length === 0) {
    throw new Error(`${source}.pools must be a non-empty array`);
  }

  value.pools.forEach((pool, index) => {
    assertRecord(pool, `${source}.pools[${index}]`);
    assertKnownKeys(
      pool,
      ['address', 'direction', 'fee'],
      `${source}.pools[${index}]`,
    );
    assertAddress(pool.address, `${source}.pools[${index}].address`);
    assertBoolean(pool.direction, `${source}.pools[${index}].direction`);
    assertInteger(pool.fee, `${source}.pools[${index}].fee`);
  });
}

function validateBalancerV2Data(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(value, ['swaps', 'isApproved'], source);
  assertOptionalBoolean(value.isApproved, `${source}.isApproved`);

  if (!Array.isArray(value.swaps) || value.swaps.length === 0) {
    throw new Error(`${source}.swaps must be a non-empty array`);
  }

  value.swaps.forEach((swap, index) => {
    assertRecord(swap, `${source}.swaps[${index}]`);
    assertKnownKeys(swap, ['poolId', 'amount'], `${source}.swaps[${index}]`);
    assertBytes32(swap.poolId, `${source}.swaps[${index}].poolId`);
    assertDecimalAmount(swap.amount, `${source}.swaps[${index}].amount`);
  });
}

function validateCurveV1Data(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    ['exchange', 'i', 'j', 'underlyingSwap', 'deadline', 'isApproved'],
    source,
  );
  assertAddress(value.exchange, `${source}.exchange`);
  assertInteger(value.i, `${source}.i`);
  assertInteger(value.j, `${source}.j`);
  assertBoolean(value.underlyingSwap, `${source}.underlyingSwap`);
  assertInteger(value.deadline, `${source}.deadline`);
  assertOptionalBoolean(value.isApproved, `${source}.isApproved`);
}

function validateCurveV2Data(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    ['i', 'j', 'exchange', 'originalPoolAddress', 'swapType', 'isApproved'],
    source,
  );
  assertInteger(value.i, `${source}.i`);
  assertInteger(value.j, `${source}.j`);
  assertAddress(value.exchange, `${source}.exchange`);
  assertAddress(value.originalPoolAddress, `${source}.originalPoolAddress`);
  assertInteger(value.swapType, `${source}.swapType`);
  assertOptionalBoolean(value.isApproved, `${source}.isApproved`);
}

function validateLitePsmData(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    ['psmAddress', 'gemDecimals', 'toll', 'isApproved'],
    source,
  );
  assertAddress(value.psmAddress, `${source}.psmAddress`);
  assertInteger(value.gemDecimals, `${source}.gemDecimals`);
  assertDecimalAmount(value.toll, `${source}.toll`);
  assertOptionalBoolean(value.isApproved, `${source}.isApproved`);
}

function validateGenericRfqData(value: unknown, source: string): void {
  assertRecord(value, source);
  assertKnownKeys(
    value,
    ['orderInfos', 'maxOrdersCount', 'isApproved'],
    source,
  );
  assertOptionalBoolean(value.isApproved, `${source}.isApproved`);

  if (!Array.isArray(value.orderInfos) || value.orderInfos.length === 0) {
    throw new Error(`${source}.orderInfos must be a non-empty array`);
  }

  assertJsonValue(value.orderInfos, `${source}.orderInfos`);

  if (value.maxOrdersCount !== undefined) {
    assertInteger(value.maxOrdersCount, `${source}.maxOrdersCount`);
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  source: string,
): void {
  const allowed = new Set(allowedKeys);
  Object.keys(value).forEach(key => {
    if (!allowed.has(key)) {
      throw new Error(`${source}: unknown field ${key}`);
    }
  });
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

function assertOptionalAddress(value: unknown, source: string): void {
  if (value !== undefined) {
    assertAddress(value, source);
  }
}

function assertDecimalAmount(value: unknown, source: string): void {
  if (typeof value !== 'string' || !DECIMAL_AMOUNT_RE.test(value)) {
    throw new Error(`${source} must be a decimal amount string`);
  }
}

function assertHex(value: unknown, source: string): void {
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    throw new Error(`${source} must be 0x-prefixed lowercase even-length hex`);
  }
}

function assertBytes32(value: unknown, source: string): void {
  if (typeof value !== 'string' || !/^0x[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${source} must be a lowercase bytes32 hex string`);
  }
}

function assertBoolean(value: unknown, source: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(`${source} must be boolean`);
  }
}

function assertOptionalBoolean(value: unknown, source: string): void {
  if (value !== undefined) {
    assertBoolean(value, source);
  }
}

function assertInteger(value: unknown, source: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new Error(`${source} must be an integer`);
  }
}

function assertOptionalInteger(value: unknown, source: string): void {
  if (value !== undefined) {
    assertInteger(value, source);
  }
}

function assertNumber(value: unknown, source: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${source} must be a finite number`);
  }
}

function assertSwapSide(value: unknown, source: string): void {
  if (value !== SwapSide.SELL && value !== SwapSide.BUY) {
    throw new Error(`${source} must be SELL or BUY`);
  }
}

function assertOptionalString(value: unknown, source: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${source} must be a string`);
  }
}

function assertJsonValue(value: unknown, source: string): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertJsonValue(item, `${source}[${index}]`),
    );
    return;
  }

  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, child]) =>
      assertJsonValue(child, `${source}.${key}`),
    );
    return;
  }

  throw new Error(`${source} must be JSON-serializable`);
}
