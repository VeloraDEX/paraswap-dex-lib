import { Address } from '../../types';

export type PoolState = {
  exchangeRate: bigint;
};

export type StkGHOData = {
  exchange: Address;
};

export type DexParams = {
  stkGHO: Address;
  GHO: Address;
};
