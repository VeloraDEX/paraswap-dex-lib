import { RequestHeaders } from '../../dex-helper';
import { Address, NumberAsString } from '../../types';

export type DexParams = {
  routerAddress: Address;
  chainName: string;
};

export type NativeOrderbookLevel = [number, number];

export type NativeOrderbookEntry = {
  base_symbol: string;
  base_address: Address;
  quote_symbol: string;
  quote_address: Address;
  side: 'bid' | 'ask';
  minimum_in_base?: number;
  levels: NativeOrderbookLevel[];
};

export type NativeOrderbookResponse = NativeOrderbookEntry[];

export type NativeBlacklistEntry = {
  id: string;
  address: Address;
  chainId: number;
  createTime: number;
};

export type NativeBlacklistResponse = {
  black_list: NativeBlacklistEntry[];
};

export type NativeRateFetcherConfig = {
  rateConfig: {
    orderbookReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    orderbookCacheKey: string;
    orderbookCacheTTLSecs: number;
    orderbookIntervalMs: number;
    blacklistReqParams: {
      url: string;
      headers?: RequestHeaders;
    };
    blacklistIntervalMs: number;
    setBlacklist: (addresses: string[]) => Promise<void>;
  };
};

export type NativeFirmQuoteOrder = {
  pool: Address;
  signer: Address;
  recipient: Address;
  sellerToken: Address;
  buyerToken: Address;
  sellerTokenAmount: NumberAsString;
  buyerTokenAmount: NumberAsString;
  amountOutMinimum: NumberAsString;
  deadlineTimestamp: number;
  nonce: number;
  quoteId: string;
  multiHop: boolean;
  signature: string;
};

export type NativeWidgetFee = {
  signer: Address;
  feeRecipient: Address;
  feeRate: number;
};

export type NativeTxRequest = {
  target: Address;
  calldata: string;
  value: string;
};

export type NativeFirmQuoteResponse = {
  success: boolean;
  orders: NativeFirmQuoteOrder[];
  widgetFee?: NativeWidgetFee | null;
  widgetFeeSignature?: string;
  recipient: Address;
  amountIn: NumberAsString;
  amountOut: NumberAsString;
  amountOutBeforeFee?: NumberAsString;
  tokenTransferFeeOnPercent?: number;
  txRequest: NativeTxRequest;
  quoteId?: string;
  errorMessage?: string;
};

export type NativeData = {
  quote?: NativeFirmQuoteResponse;
};
