import { AlpacaPoolTokens } from './config';
import { Result } from '@ethersproject/abi';
import { Address } from '../../types';
import { BigNumber } from 'ethers';

export type PoolState = {
  // TODO: poolState is the state of event
  // subscriber. This should be the minimum
  // set of parameters required to compute
  // pool prices. Complete me!
  prices: IPriceFeedState;
  vault: IVaultState;
  investPool: IInvestPoolProps[];
  log?: ISwapLogEvent;
};

export type IPriceFeedState = {
  lastUpdatedAt: number;
  prices: { [tokenAddress: string]: bigint };
};

export type IVaultState = {
  alpAmounts: { [tokenAddress: string]: bigint };
};

export type ISwapLogEvent = {
  account: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  amountOutAfterFee: bigint;
  swapFeeBps: bigint;
};

export interface ICallData {
  target: string;
  callData: string;
}

export type AlpacaData = {
  // TODO: AlpacaData is the dex data that is
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  // Complete me!
};

export type DexParams = {
  poolRouter: string;
  Pyth: string;
  poolDiamond: string;
  alpacaPoolTokens: Record<string, IPoolToken>;
};

export type IAlpacaPoolConfigs = {
  poolTokens: Record<string, IPoolToken>;
};

export type Price = {
  conf: string;
  expo: number;
  price: string;
  publishTime: number;
};

export type PriceFeedMetadata = {
  attestationTime: number;
  emitterChain: number;
  priceServiceReceiveTime: number;
  sequenceNumber: number;
};

export type PriceFeed = {
  ema_price: Price;
  id: string;
  metadata?: PriceFeedMetadata;
  vaa: string;
  price: Price;
};

export type IPoolToken = {
  symbol: string;
  address: string;
  priceId: string;
  decimal: number;
};

export type IInvestPoolProps = {
  stableSwapFeeRate: BigNumber;
  stableTaxRate: BigNumber;
  swapFeeRate: BigNumber;
  taxRate: BigNumber;
  liquidity: BigNumber;
  isStrategyProfit: boolean;
  strategyDelta: BigNumber;
  reservedOf: BigNumber;
  guaranteedUsdOfE30: BigNumber;
  shortSizeOfE30: BigNumber;
  shortAveragePriceOfE30: BigNumber;
  tokenMetas: ITokenConfigStructOutput;
  tokenAddress: string;
  maxPrice: BigNumber;
  minPrice: BigNumber;
  isDynamicFeeEnable: boolean;
  additionalAum: BigNumber;
  discountedAum: BigNumber;
  fundingFeePayableE30: BigNumber;
  fundingFeeReceivableE30: BigNumber;
  priceUpdateData: string;
};

export type ITokenConfigStructOutput = {
  accept: boolean;
  isStable: boolean;
  isShortable: boolean;
  decimals: number;
  weight: BigNumber;
  minProfitBps: BigNumber;
  usdDebtCeiling: BigNumber;
  shortCeiling: BigNumber;
  bufferLiquidity: BigNumber;
  openInterestLongCeiling: BigNumber;
};
