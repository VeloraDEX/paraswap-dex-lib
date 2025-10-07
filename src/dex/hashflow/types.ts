import { Chain, QuoteData } from '@hashflow/taker-js/dist/types/common';
import { RequestHeaders } from '../../dex-helper';
import { ERROR_CODE_TO_RESTRICT_TTL, UNKNOWN_ERROR_CODE } from './constants';

export type HashflowData = {
  mm: string;
  quoteData?: QuoteData;
  signature?: string;
};

export type DexParams = {
  routerAddress: string;
};

export interface PriceLevel {
  q: string;
  p: string;
}

export class RfqError extends Error {
  code: ErrorCode;
  constructor(message: string, code: ErrorCode = UNKNOWN_ERROR_CODE) {
    super(message);
    this.code = code;
  }
}

export enum RFQType {
  RFQT = 0,
  RFQM = 1,
}

export type HashflowRatesLevel = {
  pair: Record<string, string>;
  levels: Array<Record<string, string>>;
};

export type HashflowMarketMakersResponse = {
  marketMakers: string[];
};

export type HashflowRatesResponse = {
  status: string;
  baseChain: Chain;
  quoteChain: Chain;
  levels: Record<string, Array<HashflowRatesLevel>>;
};

export type HashflowRateFetcherConfig = {
  rateConfig: {
    marketMakersReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    pricesReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    pricesIntervalMs: number;
    markerMakersIntervalMs: number;
    getCachedMarketMakers: () => Promise<string[] | null>;
    filterMarketMakers: (makers: string[]) => Promise<string[]>;
    pricesCacheKey: string;
    marketMakersCacheKey: string;
    pricesCacheTTLSecs: number;
    marketMakersCacheTTLSecs: number;
  };
};

export type ErrorCode = keyof typeof ERROR_CODE_TO_RESTRICT_TTL;

export type CacheErrorCodesData = {
  [code in ErrorCode]: {
    addedDatetimeMS: number;
    count: number;
  } | null;
};
