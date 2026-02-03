import { Address } from '../../types';

export type PoolState = {};

export type UsualBondData = {};

export type DexParams = {
  fromToken: { address: Address; decimals: number };
  toToken: { address: Address; decimals: number };
};

export type MultiTokenDexParams = {
  fromTokens: { address: Address; decimals: number; swapFunction: string }[];
  toToken: { address: Address; decimals: number };
};
