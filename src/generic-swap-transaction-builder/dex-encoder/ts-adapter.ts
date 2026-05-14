import { Interface } from '@ethersproject/abi';
import { SwapSide } from '@paraswap/core';
import ERC20ABI from '../../abi/erc20.json';
import { NULL_ADDRESS } from '../../constants';
import type { DexAdapterService } from '../../dex';
import type { IDexTxBuilder, NeedWrapNativeFunc } from '../../dex/idex';
import { WethFunctions } from '../../dex/weth/types';
import type { ExecutorEncodingContext } from '../../executor/encoding-types';
import type {
  Address,
  DexExchangeParam as LegacyDexExchangeParam,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
} from '../../types';
import {
  SPECIAL_DEX_FLAG_RESERVED_RANGE,
  type DexEncoderJsonValue,
  type DexParamInput,
  type DexExchangeParam,
  type DirectParamInput,
  type DirectParamResult,
  type NeedWrapNativeInput,
  type WethDepositWithdrawInput,
  type WethDepositWithdrawResult,
} from './types';
import { isDirectContractMethodV6 } from './direct-methods';
import type {
  DexEncoderPort,
  DexEncoderRegistryPort,
  DirectDexEncoderPort,
  WethCallDataProviderPort,
} from './ports';

type TsDexAdapterService = Pick<
  DexAdapterService,
  'network' | 'getTxBuilderDexByKey'
>;

type DirectMethodProvider = {
  getDirectFunctionNameV6?: () => string[];
};

const ERC20_INTERFACE = new Interface(ERC20ABI);

const DEX_EXCHANGE_PARAM_FIELDS = new Set([
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
]);

export function createTsDexEncoderRegistry(
  dexAdapterService: TsDexAdapterService,
): DexEncoderRegistryPort {
  return new TsDexEncoderRegistryAdapter(dexAdapterService);
}

export class TsDexEncoderRegistryAdapter implements DexEncoderRegistryPort {
  constructor(private readonly dexAdapterService: TsDexAdapterService) {}

  async getDexEncoder({
    network,
    dexKey,
  }: {
    network: number;
    dexKey: string;
  }): Promise<DexEncoderPort> {
    this.assertNetwork(network);

    return new TsDexEncoderAdapter(
      dexKey,
      this.dexAdapterService.getTxBuilderDexByKey(dexKey),
    );
  }

  async getDirectDexEncoder({
    network,
    dexKey,
    contractMethod,
  }: {
    network: number;
    dexKey: string;
    contractMethod: DirectParamInput['contractMethod'];
  }): Promise<DirectDexEncoderPort> {
    this.assertNetwork(network);

    if (!isDirectContractMethodV6(contractMethod)) {
      throw new Error(`Unsupported V6 direct method ${contractMethod}`);
    }

    const dex = this.dexAdapterService.getTxBuilderDexByKey(dexKey);
    if (!dex) throw new Error(`Failed to find dex : ${dexKey}`);

    if (!dex.getDirectParamV6) {
      throw new Error(
        `Invalid DEX: dex should have getDirectParamV6: ${dexKey}`,
      );
    }

    const supportedMethods = getSupportedDirectMethods(dex);
    if (
      !supportedMethods.some(
        method => method.toLowerCase() === contractMethod.toLowerCase(),
      )
    ) {
      throw new Error(
        `Invalid DEX: ${dexKey} does not support direct method ${contractMethod}`,
      );
    }

    return new TsDirectDexEncoderAdapter(dexKey, contractMethod, dex);
  }

  private assertNetwork(network: number): void {
    if (network !== this.dexAdapterService.network) {
      throw new Error(
        `DEX encoder registry network mismatch: lookup ${network}, adapter ${this.dexAdapterService.network}`,
      );
    }
  }
}

class TsDexEncoderAdapter implements DexEncoderPort {
  constructor(
    private readonly dexKey: string,
    private readonly dex: IDexTxBuilder<unknown, unknown>,
  ) {}

  async needWrapNative(input: NeedWrapNativeInput): Promise<boolean> {
    return resolveNeedWrapNative(this.dex.needWrapNative, input, this.dexKey);
  }

  async getDexParam(input: DexParamInput): Promise<DexExchangeParam> {
    if (!this.dex.getDexParam) {
      throw new Error(
        `Invalid DEX: dex should have getDexParam: ${this.dexKey}`,
      );
    }

    const result = await this.dex.getDexParam(
      input.srcToken,
      input.destToken,
      input.srcAmount,
      input.destAmount,
      input.recipient,
      input.data,
      input.side,
      input.executorAddress,
    );

    return normalizeDexExchangeParam(result, input, this.dexKey);
  }
}

class TsDirectDexEncoderAdapter implements DirectDexEncoderPort {
  constructor(
    private readonly dexKey: string,
    private readonly contractMethod: DirectParamInput['contractMethod'],
    private readonly dex: IDexTxBuilder<unknown, unknown>,
  ) {}

  async getDirectParam(input: DirectParamInput): Promise<DirectParamResult> {
    if (input.contractMethod !== this.contractMethod) {
      throw new Error(
        `Direct DEX encoder method mismatch: lookup ${this.contractMethod}, input ${input.contractMethod}`,
      );
    }

    if (!this.dex.getDirectParamV6) {
      throw new Error(
        `Invalid DEX: dex should have getDirectParamV6: ${this.dexKey}`,
      );
    }

    const result = (await this.dex.getDirectParamV6(
      input.srcToken,
      input.destToken,
      input.srcAmount,
      input.destAmount,
      input.quotedAmount,
      input.data,
      input.side,
      input.permit,
      input.uuid,
      input.partnerAndFee,
      input.beneficiary,
      input.blockNumber,
      input.contractMethod,
    )) as { params: unknown };

    return {
      params: cloneJsonValue(result.params, `${this.dexKey}.params`),
    };
  }
}

export function createWethCallDataProvider(
  context: ExecutorEncodingContext,
): WethCallDataProviderPort {
  return {
    getDepositWithdrawCallData(input) {
      return buildWethDepositWithdrawCallData(context, input);
    },
  };
}

function buildWethDepositWithdrawCallData(
  context: ExecutorEncodingContext,
  { srcAmountWeth, destAmountWeth, side }: WethDepositWithdrawInput,
): WethDepositWithdrawResult {
  const result: WethDepositWithdrawResult = {};
  let needWithdraw = false;

  if (srcAmountWeth !== '0') {
    result.deposit = {
      callee: context.wrappedNativeTokenAddress,
      calldata: ERC20_INTERFACE.encodeFunctionData(
        WethFunctions.deposit,
      ) as `0x${string}`,
      value: srcAmountWeth,
    };

    if (side === SwapSide.BUY) needWithdraw = true;
  }

  if (needWithdraw || destAmountWeth !== '0') {
    result.withdraw = {
      callee: NULL_ADDRESS,
      calldata: ERC20_INTERFACE.encodeFunctionData(WethFunctions.withdraw, [
        destAmountWeth,
      ]) as `0x${string}`,
      value: '0',
    };
  }

  return result;
}

function normalizeDexExchangeParam(
  raw: LegacyDexExchangeParam,
  input: NeedWrapNativeInput,
  dexKey: string,
): DexExchangeParam {
  if (!isPlainObject(raw)) {
    throw new Error(
      `Invalid DEX: getDexParam must return an object for ${dexKey}`,
    );
  }

  Object.keys(raw).forEach(field => {
    if (!DEX_EXCHANGE_PARAM_FIELDS.has(field)) {
      throw new Error(
        `Invalid DEX: unsupported getDexParam field ${field} for ${dexKey}`,
      );
    }
  });

  const record = raw as Record<string, unknown>;
  const output: DexExchangeParam = {
    needWrapNative: resolveNeedWrapNative(record.needWrapNative, input, dexKey),
    exchangeData: requiredHex(record.exchangeData, dexKey, 'exchangeData'),
    targetExchange: requiredAddress(
      record.targetExchange,
      dexKey,
      'targetExchange',
    ),
    dexFuncHasRecipient: requiredBoolean(
      record.dexFuncHasRecipient,
      dexKey,
      'dexFuncHasRecipient',
    ),
  };

  assignOptionalBoolean(output, record, dexKey, 'needUnwrapNative');
  assignOptionalBoolean(output, record, dexKey, 'skipApproval');
  assignOptionalAddress(output, record, dexKey, 'wethAddress');
  assignOptionalNumber(output, record, dexKey, 'specialDexFlag');
  assignOptionalAddress(output, record, dexKey, 'transferSrcTokenBeforeSwap');
  assignOptionalAddress(output, record, dexKey, 'spender');
  assignOptionalBoolean(
    output,
    record,
    dexKey,
    'sendEthButSupportsInsertFromAmount',
  );
  assignOptionalBoolean(
    output,
    record,
    dexKey,
    'specialDexSupportsInsertFromAmount',
  );
  assignOptionalBoolean(
    output,
    record,
    dexKey,
    'swappedAmountNotPresentInExchangeData',
  );
  assignOptionalNumber(output, record, dexKey, 'returnAmountPos');
  assignOptionalNumber(output, record, dexKey, 'insertFromAmountPos');
  assignOptionalBoolean(output, record, dexKey, 'amountsPacked128');
  assignOptionalBoolean(output, record, dexKey, 'permit2Approval');

  return output;
}

function resolveNeedWrapNative(
  needWrapNative: unknown,
  input: NeedWrapNativeInput,
  dexKey: string,
): boolean {
  const resolved =
    typeof needWrapNative === 'function'
      ? (needWrapNative as NeedWrapNativeFunc)(
          ...buildLegacyNeedWrapArgs(input),
        )
      : needWrapNative;

  if (typeof resolved !== 'boolean') {
    throw new Error(
      `Invalid DEX: needWrapNative must resolve to boolean for ${dexKey}`,
    );
  }

  return resolved;
}

function buildLegacyNeedWrapArgs(
  input: NeedWrapNativeInput,
): [OptimalRate, OptimalSwap, OptimalSwapExchange<unknown>] {
  const swapExchange = {
    exchange: input.swapExchange.exchange,
    srcAmount: input.swapExchange.srcAmount,
    destAmount: input.swapExchange.destAmount,
    percent: input.swapExchange.percent,
    data: input.swapExchange.data,
  } as OptimalSwapExchange<unknown>;
  const swap = {
    srcToken: input.swap.srcToken,
    destToken: input.swap.destToken,
    srcDecimals: 0,
    destDecimals: 0,
    srcAmount: input.swap.srcAmount,
    destAmount: input.swap.destAmount,
    swapExchanges: [swapExchange],
  } as OptimalSwap;
  const priceRoute = {
    network: input.route.network,
    side: input.route.side,
    srcToken: input.route.srcToken,
    destToken: input.route.destToken,
    srcAmount: input.route.srcAmount,
    destAmount: input.route.destAmount,
    blockNumber: input.route.blockNumber,
    bestRoute: [{ percent: input.route.routePercent, swaps: [swap] }],
  } as OptimalRate;

  return [priceRoute, swap, swapExchange];
}

function getSupportedDirectMethods(
  dex: IDexTxBuilder<unknown, unknown>,
): string[] {
  const instanceProvider = dex as DirectMethodProvider;
  if (typeof instanceProvider.getDirectFunctionNameV6 === 'function') {
    return instanceProvider.getDirectFunctionNameV6();
  }

  const constructorProvider = dex.constructor as DirectMethodProvider;
  if (typeof constructorProvider.getDirectFunctionNameV6 === 'function') {
    return constructorProvider.getDirectFunctionNameV6();
  }

  return [];
}

function assignOptionalBoolean<
  T extends keyof Pick<
    DexExchangeParam,
    | 'needUnwrapNative'
    | 'skipApproval'
    | 'sendEthButSupportsInsertFromAmount'
    | 'specialDexSupportsInsertFromAmount'
    | 'swappedAmountNotPresentInExchangeData'
    | 'amountsPacked128'
    | 'permit2Approval'
  >,
>(
  output: DexExchangeParam,
  record: Record<string, unknown>,
  dexKey: string,
  field: T,
): void {
  if (record[field] == null) return;
  output[field] = requiredBoolean(record[field], dexKey, field);
}

function assignOptionalAddress<
  T extends keyof Pick<
    DexExchangeParam,
    'wethAddress' | 'transferSrcTokenBeforeSwap' | 'spender'
  >,
>(
  output: DexExchangeParam,
  record: Record<string, unknown>,
  dexKey: string,
  field: T,
): void {
  if (record[field] == null) return;
  output[field] = requiredAddress(record[field], dexKey, field);
}

function assignOptionalNumber<
  T extends keyof Pick<
    DexExchangeParam,
    'specialDexFlag' | 'returnAmountPos' | 'insertFromAmountPos'
  >,
>(
  output: DexExchangeParam,
  record: Record<string, unknown>,
  dexKey: string,
  field: T,
): void {
  if (record[field] == null) return;
  const value = requiredNumber(record[field], dexKey, field);

  if (
    field === 'specialDexFlag' &&
    (value < SPECIAL_DEX_FLAG_RESERVED_RANGE.min ||
      value > SPECIAL_DEX_FLAG_RESERVED_RANGE.max)
  ) {
    throw new Error(
      `Invalid DEX: ${dexKey}.${field} must be within reserved range ${SPECIAL_DEX_FLAG_RESERVED_RANGE.min}-${SPECIAL_DEX_FLAG_RESERVED_RANGE.max}`,
    );
  }

  output[field] = value;
}

function requiredBoolean(
  value: unknown,
  dexKey: string,
  field: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid DEX: ${dexKey}.${field} must be boolean`);
  }

  return value;
}

function requiredNumber(value: unknown, dexKey: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid DEX: ${dexKey}.${field} must be a finite number`);
  }

  return value;
}

function requiredAddress(
  value: unknown,
  dexKey: string,
  field: string,
): Address {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(
      `Invalid DEX: ${dexKey}.${field} must be a 42-character hex address`,
    );
  }

  return value.toLowerCase();
}

function requiredHex(
  value: unknown,
  dexKey: string,
  field: string,
): `0x${string}` {
  if (typeof value !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(value)) {
    throw new Error(
      `Invalid DEX: ${dexKey}.${field} must be 0x-prefixed even-length hex`,
    );
  }

  return value.toLowerCase() as `0x${string}`;
}

function cloneJsonValue(value: unknown, field: string): DexEncoderJsonValue[] {
  const cloned = cloneDirectParamJsonValue(value, field);

  if (!Array.isArray(cloned)) {
    throw new Error(`Invalid DEX: ${field} must be an array`);
  }

  return cloned as DexEncoderJsonValue[];
}

function cloneDirectParamJsonValue(
  value: unknown,
  field: string,
): DexEncoderJsonValue {
  if (value === null) return null;

  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(
        `Invalid DEX: ${field} must be JSON-serializable; non-finite numbers are not supported`,
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      cloneDirectParamJsonValue(item, `${field}[${index}]`),
    );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneDirectParamJsonValue(item, `${field}.${key}`),
      ]),
    );
  }

  throw new Error(
    `Invalid DEX: ${field} must be JSON-serializable; received ${typeof value}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
