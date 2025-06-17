import { Address } from '../../types';

// Pendle SDK related types
export type PendleSDKMarket = {
  address: string;
  ptAddress: string;
  ptDecimals: number;
  ytAddress: string;
  underlyingAssetAddress: string;
  name: string;
  expiry: number;
  chainId: number;
};

export type AaveV3PtRollOverData = {
  srcMarketAddress: Address;
  destMarketAddress: Address;
};

export type PendleToken = {
  address: Address;
  decimals: number;
  name: string;
  expiry: number;
};

export type DexParams = {
  pendleRouterAddress: Address;
  oldPendleToken: PendleToken;
  newPendleToken: PendleToken;
  oldMarketAddress: Address;
  newMarketAddress: Address;
  oracleAddress: Address;
  underlyingAssetAddress: Address;
};
