import { Address, NumberAsString } from '../../types';
import { BigNumber } from 'ethers';

// Pendle SDK related types
export type PendleSDKMarket = {
  address: string;
  ptAddress: string;
  ytAddress: string;
  underlyingAssetAddress: string;
  name: string;
  expiry: number;
  chainId: number;
};

export type PendleSDKQuoteParams = {
  srcMarketAddress: string;
  dstMarketAddress: string;
  ptAmountIn?: string;
  lpAmountIn?: string;
  slippage: number;
};

export type PendleSDKQuoteResponse = {
  amountPtOut?: string;
  amountLpOut?: string;
  priceImpact?: number;
  data?: {
    amountPtOut?: string;
    amountLpOut?: string;
    priceImpact?: number;
  };
};

export type PendleSDKTransactionParams = {
  receiver: string;
  slippage: number;
  dstMarket: string;
  lpAmount?: string;
  ptAmount?: string;
  ytAmount?: string;
  zpi?: boolean;
};

export type PendleSDKTransactionResponse = {
  tx: {
    to: string;
    data: string;
    value?: string;
  };
  data: {
    amountLpOut?: string;
    amountPtOut?: string;
    priceImpact?: number;
  };
};

export type AaveV3PtRollOverData = {
  srcPtAddress: Address;
  destPtAddress: Address;
  srcMarketAddress: Address;
  destMarketAddress: Address;
  sdkQuotedPtOut?: string;
  blockNumber: number;
};

export type DexParams = {
  chainId: number;
  pendleSdkBaseUrl: string;
  defaultSlippageForQuoting: number;
  pendleRouterAddress: Address;
  oldPtAddress: { address: Address; decimals: number };
  newPtAddress: { address: Address; decimals: number };
  oldMarketAddress: Address;
  newMarketAddress: Address;
  oracleAddress: Address;
  decimals: number;
  aaveAssetMapping: Record<string, Address>;
};
