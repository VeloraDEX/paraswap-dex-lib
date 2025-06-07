import { Interface } from '@ethersproject/abi';
import { BigNumber, Contract } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { PoolKey } from '../synthetix/types';

import CoreABI from '../../abi/ekubo/core.json';
import DataFetcherABI from '../../abi/ekubo/data-fetcher.json';
import TwammDataFetcherABI from '../../abi/ekubo/twamm-data-fetcher.json';
import TwammABI from '../../abi/ekubo/twamm.json';

export type Pool = {
  key: PoolKey;
  activeTick: number;
  liquidity: bigint;
  sqrtRatio: bigint;
  ticks: bigint[];
};

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
  apiUrl: string;
  core: string;
  oracle: string;
  twamm: string;
  dataFetcher: string;
  twammDataFetcher: string;
  router: string;
};

export type EkuboContract = {
  contract: Contract;
  interface: Interface;
  dataFetcher: Contract;
};

export type EkuboContracts = Record<'core' | 'twamm', EkuboContract>;

export function contractsFromDexParams(
  params: DexParams,
  dexHelper: IDexHelper,
): EkuboContracts {
  return {
    core: {
      contract: new Contract(params.core, CoreABI, dexHelper.provider),
      interface: new Interface(CoreABI),
      dataFetcher: new Contract(
        params.dataFetcher,
        DataFetcherABI,
        dexHelper.provider,
      ),
    },
    twamm: {
      contract: new Contract(params.twamm, TwammABI, dexHelper.provider),
      interface: new Interface(TwammABI),
      dataFetcher: new Contract(
        params.twammDataFetcher,
        TwammDataFetcherABI,
        dexHelper.provider,
      ),
    },
  };
}

export type AbiPoolKey = {
  token0: string;
  token1: string;
  config: string;
};

export type VanillaPoolParameters = {
  fee: bigint;
  tickSpacing: number;
};
