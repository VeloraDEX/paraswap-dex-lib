import type { ExecutorEncodingContext } from '../../executor/encoding-types';
import type {
  DexExchangeParam,
  DexParamInput,
  DirectParamInput,
  DirectParamResult,
  NeedWrapNativeInput,
  WethDepositWithdrawInput,
  WethDepositWithdrawResult,
} from './types';

// Dependency direction: dex-encoder may depend on executor context types for
// construction signatures, but executor modules must not import dex-encoder.

export type MaybePromise<T> = T | Promise<T>;

export type DexEncoderPort = {
  needWrapNative(input: NeedWrapNativeInput): MaybePromise<boolean>;
  getDexParam(input: DexParamInput): MaybePromise<DexExchangeParam>;
};

export type DirectDexEncoderPort = {
  getDirectParam(input: DirectParamInput): MaybePromise<DirectParamResult>;
};

export type DexEncoderLookup = {
  network: number;
  dexKey: string;
};

export type DirectDexEncoderLookup = DexEncoderLookup & {
  contractMethod: DirectParamInput['contractMethod'];
};

export type DexEncoderRegistryPort = {
  getDexEncoder(lookup: DexEncoderLookup): MaybePromise<DexEncoderPort>;
  getDirectDexEncoder(
    lookup: DirectDexEncoderLookup,
  ): MaybePromise<DirectDexEncoderPort>;
};

export type WethCallDataProviderPort = {
  getDepositWithdrawCallData(
    input: WethDepositWithdrawInput,
  ): MaybePromise<WethDepositWithdrawResult | undefined>;
};

// Implemented by createWethCallDataProvider(...) in the TS adapter.
export type CreateWethCallDataProviderPort = (
  context: ExecutorEncodingContext,
) => WethCallDataProviderPort;

export type CreateWethCallDataProvider = CreateWethCallDataProviderPort;
