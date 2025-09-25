import { Address } from '../../types';

export type AavePtToUnderlyingData = {
  marketAddress: Address;
};

export interface SupportedPt {
  ptAddress: string;
  ptDecimals: number;
  expiry: number; // Unix timestamp in seconds
  marketAddress: string;
  underlyingAddress: string;
}

export interface DexParams {
  pendleRouterAddress: string;
  oracleAddress: string;
  underlyingAddresses: Record<string, Address>;
}

export interface Market {
  name: string;
  address: string;
  expiry: string; // ISO date string
  pt: Address;
  underlyingAsset: Address;
}
