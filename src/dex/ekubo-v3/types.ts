import { Interface } from '@ethersproject/abi';
import { BigNumber, Contract } from 'ethers';
import { PoolKey } from '../synthetix/types';

export type Pool = {
  key: PoolKey;
  activeTick: number;
  liquidity: bigint;
  sqrtRatio: bigint;
  ticks: bigint[];
};

export type BasicQuoteData = {
  tick: BigNumber;
  sqrtRatio: BigNumber;
  liquidity: BigNumber;
  minTick: BigNumber;
  maxTick: BigNumber;
  ticks: {
    number: BigNumber;
    liquidityDelta: BigNumber;
  }[];
};

export type TwammQuoteData = {
  sqrtRatio: BigNumber;
  liquidity: BigNumber;
  lastVirtualOrderExecutionTime: BigNumber;
  saleRateToken0: BigNumber;
  saleRateToken1: BigNumber;
  saleRateDeltas: {
    time: BigNumber;
    saleRateDelta0: BigNumber;
    saleRateDelta1: BigNumber;
  }[];
};

export type EkuboData = {
  poolKeyAbi: AbiPoolKey;
  isToken1: boolean;
  skipAhead: Record<string, number>;
};

export type DexParams = {
  subgraphId: string;
  core: string;
  oracle: string;
  twamm: string;
  mevCapture: string;
  quoteDataFetcher: string;
  twammDataFetcher: string;
  router: string;
};

export type EkuboContract = {
  contract: Contract;
  interface: Interface;
  quoteDataFetcher: Contract;
};

export type EkuboContracts = Record<'core' | 'twamm', EkuboContract>;

export type AbiPoolKey = {
  token0: string;
  token1: string;
  config: string;
};

export type VanillaPoolParameters = {
  fee: bigint;
  tickSpacing: number;
};
