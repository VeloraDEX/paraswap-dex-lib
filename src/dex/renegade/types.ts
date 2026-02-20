// Type definitions for Renegade DEX integration

import { SponsoredMatchResponse } from './api/types';

// Price level format from Renegade API
export type RenegadePriceLevel = [price: string, size: string];

// Pair data structure from Renegade API
export type RenegadeDepth = {
  bids: RenegadePriceLevel[];
  asks: RenegadePriceLevel[];
};

// Configuration for RateFetcher
export type RenegadeRateFetcherConfig = {
  apiKey: string;
  apiSecret: string;
  levelsCacheKey: string;
  levelsCacheTTL: number;
  tokenMetadataCacheKey: string;
  tokenMetadataCacheTTL: number;
};

// Token metadata
type RenegadeTokenInfo = {
  name: string;
  ticker: string;
  address: string;
  decimals: number;
  supported_exchanges: Record<string, string>;
  canonical_exchange: string;
};

// Token remap from Renegade API
export type RenegadeTokenRemap = {
  tokens: RenegadeTokenInfo[];
};

// Data structure for DEX methods
export type RenegadeData = {
  settlementTx?: RenegadeTx;
  rawResponse?: SponsoredMatchResponse;
};

// Configuration parameters for Renegade DEX per network
export type DexParams = {
  usdcAddress: string;
};

// Renegade transaction data
export type RenegadeTx = {
  to: string;
  data: string;
  value: string;
};
