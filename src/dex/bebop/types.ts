import { SwapSide } from '../../constants';
import { RequestHeaders } from '../../dex-helper';

export type BebopRateFetcherConfig = {
  rateConfig: {
    pricesReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    tokensReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    tokensIntervalMs: number;
    pricesCacheKey: string;
    tokensAddrCacheKey: string;
    tokensCacheKey: string;
    pricesCacheTTLSecs: number;
    tokensCacheTTLSecs: number;
  };
};

export type TokenDataMap = { [index: string]: BebopToken };

export type BebopToken = {
  decimals: number;
  contractAddress: string;
  ticker: string;
};

export type BebopTokensResponse = {
  tokens: { [symbol: string]: BebopToken };
};

export type BebopLevel = [price: number, size: number];

export type BebopPair = {
  bids: BebopLevel[];
  asks: BebopLevel[];
  last_update_ts: number;
};

export type BebopPricingResponse = {
  [pair: string]: BebopPair;
};

export interface BebopTx {
  to: string;
  value: string;
  data: string;
  from: string;
  gas: number;
}

export type BebopTokenAmount = {
  amount: string;
  priceUsd: number;
};

export type BebopError = {
  requestId: string;
  errorCode: number;
  message: string;
};

export type BebopData = {
  expiry?: number;
  buyTokens?: { [address: string]: BebopTokenAmount };
  sellTokens?: { [address: string]: BebopTokenAmount };
  tx?: BebopTx;
  error?: BebopError;
  quoteId?: string;
  requestId?: string;
};

export type DexParams = {
  settlementAddress: string;
  chainName: string;
  middleTokens: string[];
};

export type RoutingInstruction = {
  side: SwapSide; // Buy for bids, Sell for asks
  book: BebopPair;
  pair: string;
  targetQuote: boolean;
};

export type RestrictData = {
  count: number;
  addedDatetimeMs: number;
} | null;
