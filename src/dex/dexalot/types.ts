import { RequestHeaders } from '../../dex-helper';
import { Token } from '../../types';
import { Method } from '../../dex-helper/irequest-wrapper';

type RFQOrder = {
  nonceAndMeta: string;
  expiry: number;
  makerAsset: string;
  takerAsset: string;
  maker: string;
  taker: string;
  makerAmount: string;
  takerAmount: string;
  signature?: string;
};

export type RFQResponse = {
  order: RFQOrder;
  signature: string;
};

export type RFQResponseError = {
  Reason: string;
  ReasonCode: string;
  Success: boolean;
  RetryAfter?: number;
};

export type DexalotData = {
  quoteData?: RFQOrder;
};

export type DexParams = {
  dexalotRouterAddress: string;
};

export enum ClobSide {
  BID = 'BID',
  ASK = 'ASK',
}

export class DexalotRfqError extends Error {}

export type PairData = {
  base: string;
  quote: string;
  liquidityUSD: number;
  isSrcBase?: boolean;
};

export type PairDataMap = {
  [pair: string]: PairData;
};

export type PairDataResp = {
  base: string;
  quote: string;
  liquidityUSD: number;
  baseAddress: string;
  quoteAddress: string;
  baseDecimals: number;
  quoteDecimals: number;
};

export type DexalotPairsResponse = {
  [pair: string]: PairDataResp;
};

type PriceData = {
  bids: string[][];
  asks: string[][];
};

export type PriceDataMap = {
  [pair: string]: PriceData;
};

export type DexalotPricesResponse = {
  prices: PriceDataMap;
};

export type TokenAddrDataMap = {
  [symbol: string]: string;
};

export type TokenDataMap = {
  [address: string]: Token;
};

export type DexalotBlacklistResponse = {
  blacklist: string[];
};

export type DexalotRateFetcherConfig = {
  rateConfig: {
    pairsReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    pricesReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    blacklistReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    pairsIntervalMs: number;
    pricesIntervalMs: number;
    blacklistIntervalMs: number;
    pairsCacheKey: string;
    pricesCacheKey: string;
    tokensAddrCacheKey: string;
    tokensCacheKey: string;
    blacklistCacheKey: string;
    blacklistCacheTTLSecs: number;
    pairsCacheTTLSecs: number;
    pricesCacheTTLSecs: number;
    tokensCacheTTLSecs: number;
  };
};

export type DexalotAPIParameters = {
  url: string;
  headers?: RequestHeaders;
  params?: any;
  method?: Method;
};
