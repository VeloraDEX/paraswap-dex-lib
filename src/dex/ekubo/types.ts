import { PoolKey } from '../synthetix/types';

export type Pool = {
  key: PoolKey;
  activeTick: number;
  liquidity: bigint;
  sqrtRatio: bigint;
  ticks: bigint[];
};

export interface Tick {
  readonly number: number;
  liquidityDelta: bigint;
}

export type QuoteData = {
  tick: number;
  sqrtRatio: bigint;
  liquidity: bigint;
  minTick: number;
  maxTick: number;
  ticks: {
    number: number;
    liquidityDelta: bigint;
  }[];
};

export type GetQuoteDataResponse = QuoteData[];

export type EkuboData = {
  poolKeyAbi: AbiPoolKey;
  isToken1: boolean;
  skipAhead: Record<string, number>;
};

export type DexParams = {
  apiUrl: string;
  core: string;
  oracle: string;
  dataFetcher: string;
  router: string;
};

export type AbiPoolKey = {
  token0: string;
  token1: string;
  config: string;
};

export type VanillaPoolParameters = {
  fee: bigint;
  tickSpacing: number;
};
