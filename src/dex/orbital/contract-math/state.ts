// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Pool state for off-chain quotes, and the pieces of src/libraries/OrbitalState.sol the swap path uses.
import { mulDivUp } from './arith';
import { SQRT3_X36, WAD, X54 } from './constants';
import type { TickRecord } from './tick';

export type Triple = readonly [bigint, bigint, bigint];

/**
 * Everything a quote reads, as plain bigints. Reserves and geometry are normalized to 18 decimals; `scales[i]` is
 * `10^(18 - decimals[i])`, so `raw * scale = normalized`.
 */
export type PoolState = {
  /** Invariant reserves, including the virtual floor (`getInvariantReserves()`). */
  reserves: Triple;
  /** Interior radius. */
  rInt: bigint;
  /** Aggregate plane constant of the boundary ticks. */
  kBound: bigint;
  /** Aggregate orthogonal offset of the boundary ticks. */
  sBound: bigint;
  /** Sum of all tick radii. */
  totalRadius: bigint;
  /** Virtual reserve floor per asset. */
  floor: bigint;
  /** Highest boundary tick, 0 when none. */
  topBoundary: number;
  /** Number of boundary ticks. */
  boundaryTickCount: number;
  /** Initialized ticks in bits 40..238 (`tickBitmap()`). */
  bitmap: bigint;
  /** Record of every initialized tick (`ticks(t)` for each set bit). */
  ticks: Readonly<Record<number, TickRecord>>;
  /** Swap fee as a WAD fraction, taken on the input. */
  fee: bigint;
  /** Raw-to-normalized scale of each asset. */
  scales: Triple;
};

/** Validates public asset indices for a two-asset operation (OrbitalState.validateAssetPair). */
export function isValidAssetPair(
  assetIn: number,
  assetOut: number,
): 'Invalid asset index' | 'Same asset' | null {
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < 3;
  if (!valid(assetIn) || !valid(assetOut)) return 'Invalid asset index';
  if (assetIn === assetOut) return 'Same asset';
  return null;
}

/**
 * Smallest integer reserve sum at which a tick of plane `kNorm` is a boundary tick in a partition
 * (OrbitalState.planeCeil): `ceil(SQRT3_X36 * (kBound * WAD + rInt * kNorm) / X54)`.
 */
export function planeCeil(kBound: bigint, rInt: bigint, kNorm: bigint): bigint {
  return mulDivUp(SQRT3_X36, kBound * WAD + rInt * kNorm, X54);
}
