import { Address } from '../../types';

// State-related types

export type BmwState = {
  pools: Address[];
};

export type PoolState = {
  // poolState is the state of event
  // subscriber. This should be the minimum
  // set of parameters required to compute
  // pool prices.
  params: PoolParams;
  underlyingAddresses: Address[];
  asset: { [underlyingAddress: string]: AssetState };
};

export type AssetState = {
  address: Address;
  paused: boolean;
  cash: bigint;
  liability: bigint;
  underlyingTokenDecimals: number;
  relativePrice?: bigint;
};

export type PoolParams = {
  paused: boolean;
  ampFactor: bigint;
  haircutRate: bigint;
  withdrawalHaircutRate: bigint;
  startCovRatio: bigint;
  endCovRatio: bigint;
};

export type WombatData = {
  // TODO: WombatData is the dex data that is
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  // Complete me!
  exchange: Address;
};

export type DexParams = {
  // DexParams is set of parameters that can be used to initiate a DEX fork.
  bmwAddress: Address;
  // routerAddress?: Address;
};

export type MulticallResultOutputs =
  | boolean
  | bigint
  | Address
  | number
  | undefined;
