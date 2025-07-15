import { Address } from '../../types';

export type PoolState = {
  price: bigint;
};

export type UsualPPData = {};

export type DexParams = {
  USD0: { address: Address; decimals: number };
  USD0PP: { address: Address; decimals: number };
};
