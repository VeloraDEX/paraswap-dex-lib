import type { SwapSide } from '@paraswap/core';
import type { Address } from '../../types';
import { SpecialDex } from '../../executor/types';
import type { DirectContractMethodV6 } from './direct-methods';

export type DecimalString = string;
export type HexString = `0x${string}`;

export type DexEncoderJsonValue =
  | null
  | boolean
  | number
  | string
  | DexEncoderJsonValue[]
  | { [key: string]: DexEncoderJsonValue };

export type DexEncoderSwapExchangeData = DexEncoderJsonValue;

export type NeedWrapNativeAuditDexKey = 'CurveV1Factory' | 'CurveV1StableNg';

// Phase 0 audit: concrete V6 DEX keys under src/dex/** whose needWrapNative
// member is function-shaped instead of a static boolean.
export const AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES = [
  'CurveV1Factory',
  'CurveV1StableNg',
] as const satisfies readonly NeedWrapNativeAuditDexKey[];

export type AddressNormalizationPolicy = 'lowercase';
export type AmountNormalizationPolicy = 'decimal-string';
export type BytesNormalizationPolicy = '0x-prefixed-hex';
export type UnknownFieldPolicy = 'reject';
export type SwapExchangeDataPolicy = 'dex-owned-pass-through';
export type OptionalFieldPolicy = 'omit-or-null-normalized-to-undefined';

export type DexEncoderDtoNormalizationPolicy = {
  addressFields: AddressNormalizationPolicy;
  amountFields: AmountNormalizationPolicy;
  calldataFields: BytesNormalizationPolicy;
  swapExchangeData: SwapExchangeDataPolicy;
  unknownFields: UnknownFieldPolicy;
  optionalFields: OptionalFieldPolicy;
};

export const DEX_ENCODER_DTO_NORMALIZATION_POLICY: DexEncoderDtoNormalizationPolicy =
  {
    addressFields: 'lowercase',
    amountFields: 'decimal-string',
    calldataFields: '0x-prefixed-hex',
    swapExchangeData: 'dex-owned-pass-through',
    unknownFields: 'reject',
    optionalFields: 'omit-or-null-normalized-to-undefined',
  };

export type DexEncoderDtoFieldContract = {
  addressFields: readonly string[];
  amountFields: readonly string[];
  booleanFields: readonly string[];
  calldataFields: readonly string[];
  nullableInputFields: readonly string[];
  numberFields: readonly string[];
  passThroughFields: readonly string[];
  strictOutputFields: readonly string[];
};

// Keep this list in lockstep with SpecialDex until Phase 5 adds an enum/list
// parity test alongside the needWrapNative audit scanner.
export const KNOWN_SPECIAL_DEX_FLAGS = [
  SpecialDex.DEFAULT,
  SpecialDex.SWAP_ON_SWAAP_V2_SINGLE,
  SpecialDex.SWAP_ON_BALANCER_V1,
  SpecialDex.SWAP_ON_MAKER_PSM,
  SpecialDex.SEND_NATIVE,
  SpecialDex.SWAP_ON_BALANCER_V2,
  SpecialDex.SWAP_ON_UNISWAP_V2_FORK,
  SpecialDex.SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK,
  SpecialDex.SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK_WITH_FEE,
  SpecialDex.SWAP_ON_AUGUSTUS_RFQ,
  SpecialDex.EXECUTE_VERTICAL_BRANCHING,
  SpecialDex.BUY_ON_SOLIDLY_V3,
  SpecialDex.SWAP_ON_DEXALOT,
  SpecialDex.SWAP_ON_HASHFLOW,
] as const satisfies readonly SpecialDex[];

export const SPECIAL_DEX_FLAG_RESERVED_RANGE = {
  min: 0,
  max: 255,
} as const;

export type NeedWrapNativeRouteContext = {
  network: number;
  side: SwapSide;
  routeIndex: number;
  routePercent: number;
  blockNumber: number;
  srcToken: Address;
  destToken: Address;
  srcAmount: DecimalString;
  destAmount: DecimalString;
};

export type NeedWrapNativeSwapContext = {
  swapIndex: number;
  srcToken: Address;
  destToken: Address;
  srcAmount: DecimalString;
  destAmount: DecimalString;
};

export type NeedWrapNativeSwapExchangeContext = {
  swapExchangeIndex: number;
  exchange: string;
  srcAmount: DecimalString;
  destAmount: DecimalString;
  percent: number;
  data: DexEncoderSwapExchangeData;
};

export type NeedWrapNativeInput = {
  route: NeedWrapNativeRouteContext;
  swap: NeedWrapNativeSwapContext;
  swapExchange: NeedWrapNativeSwapExchangeContext;
};

export const NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT = {
  addressFields: [
    'route.srcToken',
    'route.destToken',
    'swap.srcToken',
    'swap.destToken',
  ],
  amountFields: [
    'route.srcAmount',
    'route.destAmount',
    'swap.srcAmount',
    'swap.destAmount',
    'swapExchange.srcAmount',
    'swapExchange.destAmount',
  ],
  booleanFields: [],
  calldataFields: [],
  nullableInputFields: ['swapExchange.data'],
  numberFields: [
    'route.network',
    'route.routeIndex',
    'route.routePercent',
    'route.blockNumber',
    'swap.swapIndex',
    'swapExchange.swapExchangeIndex',
    'swapExchange.percent',
  ],
  passThroughFields: ['swapExchange.data'],
  strictOutputFields: [],
} as const satisfies DexEncoderDtoFieldContract;

// Outer fields are the resolved getDexParam invocation. Nested route/swap
// fields are the original route context used to resolve function-shaped
// needWrapNative values returned by legacy TS DEX encoders.
export type DexParamInput = NeedWrapNativeInput & {
  dexKey: string;
  srcToken: Address;
  destToken: Address;
  srcAmount: DecimalString;
  destAmount: DecimalString;
  recipient: Address;
  executorAddress: Address;
  side: SwapSide;
  data: DexEncoderSwapExchangeData;
};

export const DEX_PARAM_INPUT_FIELD_CONTRACT = {
  addressFields: [
    ...NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT.addressFields,
    'srcToken',
    'destToken',
    'recipient',
    'executorAddress',
  ],
  amountFields: [
    ...NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT.amountFields,
    'srcAmount',
    'destAmount',
  ],
  booleanFields: NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT.booleanFields,
  calldataFields: [],
  nullableInputFields: [
    ...NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT.nullableInputFields,
    'data',
  ],
  numberFields: NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT.numberFields,
  passThroughFields: [
    ...NEED_WRAP_NATIVE_INPUT_FIELD_CONTRACT.passThroughFields,
    'data',
  ],
  strictOutputFields: [],
} as const satisfies DexEncoderDtoFieldContract;

export type DexExchangeParam = {
  needWrapNative: boolean;
  needUnwrapNative?: boolean;
  skipApproval?: boolean;
  wethAddress?: Address;
  exchangeData: HexString;
  targetExchange: Address;
  dexFuncHasRecipient: boolean;
  specialDexFlag?: SpecialDex;
  transferSrcTokenBeforeSwap?: Address;
  spender?: Address;
  sendEthButSupportsInsertFromAmount?: boolean;
  specialDexSupportsInsertFromAmount?: boolean;
  swappedAmountNotPresentInExchangeData?: boolean;
  returnAmountPos?: number;
  insertFromAmountPos?: number;
  amountsPacked128?: boolean;
  permit2Approval?: boolean;
};

export const DEX_EXCHANGE_PARAM_FIELD_CONTRACT = {
  addressFields: [
    'wethAddress',
    'targetExchange',
    'transferSrcTokenBeforeSwap',
    'spender',
  ],
  amountFields: [],
  booleanFields: [
    'needWrapNative',
    'needUnwrapNative',
    'skipApproval',
    'dexFuncHasRecipient',
    'sendEthButSupportsInsertFromAmount',
    'specialDexSupportsInsertFromAmount',
    'swappedAmountNotPresentInExchangeData',
    'amountsPacked128',
    'permit2Approval',
  ],
  calldataFields: ['exchangeData'],
  nullableInputFields: [
    'needUnwrapNative',
    'skipApproval',
    'wethAddress',
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
  numberFields: ['specialDexFlag', 'returnAmountPos', 'insertFromAmountPos'],
  passThroughFields: [],
  strictOutputFields: [
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
} as const satisfies DexEncoderDtoFieldContract;

export type DirectParamInput = {
  dexKey: string;
  network: number;
  contractMethod: DirectContractMethodV6;
  srcToken: Address;
  destToken: Address;
  srcAmount: DecimalString;
  destAmount: DecimalString;
  quotedAmount: DecimalString;
  data: DexEncoderSwapExchangeData;
  side: SwapSide;
  permit: HexString;
  uuid: string;
  partnerAndFee: DecimalString;
  beneficiary: Address;
  blockNumber: number;
};

export const DIRECT_PARAM_INPUT_FIELD_CONTRACT = {
  addressFields: ['srcToken', 'destToken', 'beneficiary'],
  amountFields: ['srcAmount', 'destAmount', 'quotedAmount', 'partnerAndFee'],
  booleanFields: [],
  calldataFields: ['permit'],
  nullableInputFields: ['data'],
  numberFields: ['network', 'blockNumber'],
  passThroughFields: ['data'],
  strictOutputFields: [],
} as const satisfies DexEncoderDtoFieldContract;

export type DirectParamResult = {
  params: DexEncoderJsonValue[];
};

export const DIRECT_PARAM_RESULT_FIELD_CONTRACT = {
  addressFields: [],
  amountFields: [],
  booleanFields: [],
  calldataFields: [],
  nullableInputFields: [],
  numberFields: [],
  passThroughFields: ['params'],
  strictOutputFields: ['params'],
} as const satisfies DexEncoderDtoFieldContract;

export type WethDepositWithdrawInput = {
  srcAmountWeth: DecimalString;
  destAmountWeth: DecimalString;
  side: SwapSide;
};

// Port-side mirror of legacy DepositWithdrawData from src/dex/weth/types.ts.
// Phase 4 TS adapter translates between the legacy shape and this DTO.
export type WethCallData = {
  callee: Address;
  calldata: HexString;
  value: DecimalString;
};

export type WethDepositWithdrawResult = {
  deposit?: WethCallData;
  withdraw?: WethCallData;
};

export const WETH_DEPOSIT_WITHDRAW_INPUT_FIELD_CONTRACT = {
  addressFields: [],
  amountFields: ['srcAmountWeth', 'destAmountWeth'],
  booleanFields: [],
  calldataFields: [],
  nullableInputFields: [],
  numberFields: [],
  passThroughFields: [],
  strictOutputFields: [],
} as const satisfies DexEncoderDtoFieldContract;

export const WETH_DEPOSIT_WITHDRAW_RESULT_FIELD_CONTRACT = {
  addressFields: ['deposit.callee', 'withdraw.callee'],
  amountFields: ['deposit.value', 'withdraw.value'],
  booleanFields: [],
  calldataFields: ['deposit.calldata', 'withdraw.calldata'],
  nullableInputFields: ['deposit', 'withdraw'],
  numberFields: [],
  passThroughFields: [],
  strictOutputFields: ['deposit', 'withdraw'],
} as const satisfies DexEncoderDtoFieldContract;
