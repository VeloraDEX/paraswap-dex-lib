import { AbiItem } from 'web3-utils';
import {
  UniswapV2Data,
  UniswapV2PoolOrderedParams,
  DexParams as UniswapV2DexParams,
  UniswapPool,
} from '../uniswap-v2/types';
import { UniswapV2Pair } from '../uniswap-v2/uniswap-v2';

export type PoolState = {
  reserves0: string;
  reserves1: string;
  feeCode: number;
};

// to calculate prices for stable pool, we need decimals of the stable tokens
export interface SolidlyPoolOrderedParams extends UniswapV2PoolOrderedParams {
  decimalsIn: number;
  decimalsOut: number;
  stable: boolean;
}

export type SolidlyPool = UniswapPool & { stable: boolean };

export type SolidlyData = {
  isFeeTokenInRoute: boolean;
  pools: SolidlyPool[];
} & UniswapV2Data;

export interface DexParams extends Omit<UniswapV2DexParams, 'feeCode'> {
  feeCode: number;
  stableFee?: number;
  volatileFee?: number;
  feeFactor?: number;
  factoryAbi?: AbiItem[];
  getPairMethodName?: string;
}

export interface SolidlyPair extends UniswapV2Pair {
  stable: boolean;
}
