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
  marketAddress: string; // V4 market address (for router)
  exitMarketAddress: string; // V2 market address (for exit-position API)
  underlyingAssetAddress: string;
  underlyingRawAddress: string; // raw ERC-20
  // Production pricing configuration
  isStablecoin?: boolean; // Whether the underlying is a stablecoin (1:1 with USD)
}

export interface DexParams {
  pendleRouterAddress: string;
  oracleAddress: string;
  supportedPts: SupportedPt[];
  // USDC token configuration
  usdcToken: {
    address: string;
    decimals: number;
    name: string;
    symbol: string;
  };
}
