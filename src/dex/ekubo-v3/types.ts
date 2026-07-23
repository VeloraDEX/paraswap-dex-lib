import { Interface } from '@ethersproject/abi';
import { BigNumber, Contract } from 'ethers';
import { BlockHeader } from 'web3-eth';

export type BasicQuoteData = {
  tick: number;
  sqrtRatio: BigNumber;
  liquidity: BigNumber;
  minTick: number;
  maxTick: number;
  ticks: {
    number: number;
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
};

export type EkuboContract = {
  contract: Contract;
  interface: Interface;
  quoteDataFetcher: Contract;
};

export type EkuboContracts = Record<
  'core' | 'twamm' | 'boostedFees',
  EkuboContract
>;

export type BoostedFeesQuoteData = {
  sqrtRatio: BigNumber;
  liquidity: BigNumber;
  lastDonateTime: BigNumber;
  donateRateToken0: BigNumber;
  donateRateToken1: BigNumber;
  donateRateDeltas: {
    time: BigNumber;
    donateRateDelta0: BigNumber;
    donateRateDelta1: BigNumber;
  }[];
};

export type AbiPoolKey = {
  token0: string;
  token1: string;
  config: string;
};

export type PoolInitializationState = {
  tick: number;
  sqrtRatio: bigint;
  blockHeader: Readonly<BlockHeader>;
};
