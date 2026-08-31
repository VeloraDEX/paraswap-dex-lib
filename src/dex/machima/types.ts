import { Address } from '../../types';
import { DexParams, UniswapV3Data } from '../uniswap-v3/types';

// Pricing/exec payload. Identical shape to UniswapV3Data: the
// MachimaAggregatorRouter classifies buy/sell direction on-chain from the
// token pair, so getDexParam only needs the standard path info.
export type MachimaData = UniswapV3Data;

// Extends the UniswapV3 fork config with Machima-specific addresses needed
// for the tax layer and the standard-interface aggregator wrappers.
export interface MachimaDexParams extends DexParams {
  weth: Address;
  usdc: Address;
  xma: Address;
  clankNow: Address;
  swapAdapter: Address;
  aggregatorRouter: Address;
  aggregatorQuoter: Address;
}

// Result of classifying a token pair against the counter-asset set.
// Mirrors MachimaAggregatorRouter._classifyPair / Kyber classifyPair.
export interface PairClassification {
  token: Address; // the launched/traded token
  counterAsset: Address; // WETH / USDC / XMA
  isBuy: boolean; // true: counter -> token, false: token -> counter
}

// Cached per-token state read from ClankNow + the token contract.
export interface MachimaTokenInfo {
  buyTaxBps: number;
  sellTaxBps: number;
  hasTax: boolean;
  poolDeploymentTime: number; // unix seconds
  fetchedAtMs: number;
  blockNumber: number; // block the tax/deploy data was read at
}
