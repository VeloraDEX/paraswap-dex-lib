import { Address } from '../../types';

export type PoolState = {
  bondingCurve: Address;
  token: Address;
  ethReserve: bigint;
  tokenReserve: bigint;
  totalTokensSold: bigint;
  graduated: boolean;
  launchId: number;
};

export type FairylaunchData = {
  exchange: Address;
  token: Address;
  ethReserve: bigint;
  tokenReserve: bigint;
  totalTokensSold: bigint;
  graduated: boolean;
  launchId: number;
};

export type DexParams = {
  launchFactoryAddress: Address;
};

export type LaunchInfo = {
  launchId: number;
  creator: Address;
  treasury: Address;
  token: Address;
  bondingCurve: Address;
  graduated: boolean;
  createdAt: number;
  graduatedAt: number;
  name: string;
  symbol: string;
  metadataUri: string;
};