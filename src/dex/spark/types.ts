import { Interface } from '@ethersproject/abi';
import { Address } from '../../types';

export type SparkData = { exchange: Address };

export type SparkParams = {
  sdaiAddress: Address;
  sdaiDecimals?: number;
  daiAddress: Address;
  daiDecimals?: number;
  usdcAddress?: Address;
  usdcDecimals?: number;
  potAddress: Address;
  psmAddress?: Address;
  savingsRate: {
    symbol: 'dsr' | 'ssr' | 'ssrOracle';
    topic: string;
  };
  poolInterface: Interface;
  exchangeInterface: Interface;
  swapFunctions:
    | typeof SparkSDaiFunctions
    | typeof SparkSUSDSFunctions
    | typeof SparkSUSDSPsmFunctions;
  referralCode: null | string;
};

export enum SparkSDaiFunctions {
  deposit = 'deposit',
  redeem = 'redeem',
  withdraw = 'withdraw',
  mint = 'mint',
}

export enum SparkSUSDSFunctions {
  deposit = 'deposit(uint256,address,uint16)',
  redeem = 'redeem',
  withdraw = 'withdraw',
  mint = 'mint(uint256,address,uint16)',
}

export enum SparkSUSDSPsmFunctions {
  deposit = 'swapExactIn(address,address,uint256)',
  redeem = 'swapExactIn(address,address,uint256)',
  withdraw = 'swapExactOut(address,address,uint256)',
  mint = 'swapExactOut(address,address,uint256)',
}

export type SparkSDaiPoolState = {
  rho: string;
  chi: string;
  dsr: string;
  live: boolean;
};
