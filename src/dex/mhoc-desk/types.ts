import { Address } from '../../types';
import { PropAMMSnapshot } from './mhoc-desk-math';

export type PoolState = PropAMMSnapshot;

export type PoolConfig = {
  // the PropAMM contract (one per pair)
  address: Address;
  // BASE() and QUOTE() of that contract, and their decimals
  base: { address: Address; decimals: number };
  quote: { address: Address; decimals: number };
  // PRICE_SCALE() and K_SCALE() of that contract (immutables)
  priceScale: bigint;
  kScale: bigint;
};

export type DexParams = {
  // pools known in advance
  pools: PoolConfig[];
  // the maker's PropAMMRegistry (optional): the pools its pools() returns are merged with the list above, their
  // immutables read on chain, so a new pair is picked up without a release
  registry?: Address;
};

export type MhocDeskData = {
  pool: Address;
};
