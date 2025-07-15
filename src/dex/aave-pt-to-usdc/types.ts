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

export type AavePtToUsdcData = {
  marketAddress: Address;
  ptAddress: Address;
  underlyingAssetAddress: Address;
};

export interface PendleToken {
  address: string;
  decimals: number;
  name: string;
  expiry: number;
}

export interface SupportedPt {
  pt: PendleToken;
  marketAddress: string;
  underlyingAssetAddress: string;
  underlyingRawAddress: string; // raw ERC-20
}

export interface DexParams {
  pendleRouterAddress: string;
  oracleAddress: string;
  supportedPts: SupportedPt[];
}
