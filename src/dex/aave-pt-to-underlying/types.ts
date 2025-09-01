import { Address } from '../../types';

export type AavePtToUnderlyingData = {
  marketAddress: Address;
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
}

export interface DexParams {
  pendleRouterAddress: string;
  oracleAddress: string;
  supportedPts: SupportedPt[];
}
