import { Address } from '../../types';
import { PoolState as OrbitalMathState } from './contract-math/state';

// Everything `quoteExactInput` / `quoteExactOutput` read, plus the shutdown flag: a shut-down pool still answers
// `quote` but refuses swaps, so it must not be priced.
export type PoolState = OrbitalMathState & {
  isShutdown: boolean;
};

// Immutables of a pool, read once at discovery.
export type OrbitalPoolInfo = {
  address: Address;
  // Permanent asset order: the indices swapExactInput / swapExactOutput take.
  assets: [Address, Address, Address];
  decimals: [number, number, number];
  fee: bigint;
};

export type OrbitalData = {
  exchange: Address;
  assetIn: number;
  assetOut: number;
};

export type DexParams = {
  factory: Address;
};
