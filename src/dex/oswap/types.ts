import { Address } from '../../types';

// OSwapPoolState is the state of the event subscriber. It is the minimum
// set of parameters required to compute pool prices.
export type OSwapPoolState = {
  traderate0: string;
  traderate1: string;
  balance0: string;
  balance1: string;
  withdrawsQueued: string;
  withdrawsClaimed: string;
};

// OSwapPoolState is the state of the event subscriber. It is the minimum
// set of parameters required to compute pool prices.
export type OSwapData = {
  pool: Address;
  path: Address[];
};

// Each pool has a contract address and token pairs.
export type OSwapPool = {
  id: string;
  address: Address;
  token0: Address;
  token1: Address;
};

export type DexParams = {
  pools: [OSwapPool];
};
