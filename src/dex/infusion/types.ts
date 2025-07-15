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
export interface InfusionPoolOrderedParams extends UniswapV2PoolOrderedParams {
  decimalsIn: number;
  decimalsOut: number;
  stable: boolean;
}

export type InfusionData = UniswapV2Data;

export type InfusionPool = UniswapPool;

export interface DexParams extends Omit<UniswapV2DexParams, 'feeCode'> {
  feeCode: number;
  stableFee?: number;
  volatileFee?: number;
  feeFactor?: number;
}

export interface InfusionPair extends UniswapV2Pair {
  stable: boolean;
}

export type InfusionParam = SellOnInfusionParam | SellETHOnInfusionParam;

export type SellOnInfusionParam = [
  amountIn: string,
  amountOutMin: string,
  routes: {
    from: string;
    to: string;
    stable: boolean;
  }[],
  to: string,
  deadline: number,
];

export type SellETHOnInfusionParam = [
  amountOutMin: string,
  routes: {
    from: string;
    to: string;
    stable: boolean;
  }[],
  to: string,
  deadline: number,
];
