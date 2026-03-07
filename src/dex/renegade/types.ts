import BigNumber from 'bignumber.js';
import { SponsoredMatchResponse } from './api/types';

export type RenegadePriceLevel = [price: string, size: string];

export type RenegadeDepth = {
  bids: RenegadePriceLevel[];
  asks: RenegadePriceLevel[];
};

export type RenegadeMarketInfo = {
  base: {
    address: string;
    symbol: string;
  };
  quote: {
    address: string;
    symbol: string;
  };
  price: {
    price: string;
    timestamp: number;
  };
};

export type RenegadeMarketDepth = {
  market: RenegadeMarketInfo;
  buy: RenegadeMarketSideDepth;
  sell: RenegadeMarketSideDepth;
};

export type RenegadeMarketDepthsResponse = {
  market_depths: RenegadeMarketDepth[];
};

export type RenegadeMarketSideDepth = {
  total_quantity: string;
  total_quantity_usd: string;
};

export type RenegadeRateFetcherConfig = {
  apiKey: string;
  apiSecret: string;
  levelsCacheKey: string;
  levelsCacheTTL: number;
  tokenMetadataCacheKey: string;
  tokenMetadataCacheTTL: number;
};

type RenegadeTokenInfo = {
  name: string;
  ticker: string;
  address: string;
  decimals: number;
  supported_exchanges: Record<string, string>;
  canonical_exchange: string;
};

export type RenegadeTokenRemap = {
  tokens: RenegadeTokenInfo[];
};

export type RenegadeData = {
  settlementTx?: RenegadeTx;
  rawResponse?: SponsoredMatchResponse;
};

export type DexParams = {
  usdcAddress: string;
};

export type RenegadeTx = {
  to: string;
  data: string;
  value: string;
};

export type RenegadeMidpointDepth = {
  price: BigNumber;
  buyBaseCapacity: BigNumber;
  sellBaseCapacity: BigNumber;
};
