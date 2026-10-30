// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Port of src/libraries/OrbitalTick.sol: the 199-boundary R40 price catalog and the tick bitmap (bits 40..238).
import { log2, mulDivNearest, sqrtNearest } from './arith';
import { MAX_TICK, MIN_TICK, SQRT3_X36, WAD, X36, X72 } from './constants';

/** Stored geometry of an initialized tick, as `OrbitalPool.ticks(tick)` returns it (xMin is not needed to quote). */
export type TickRecord = {
  /** Tick radius. */
  r: bigint;
  /** Plane constant r * kNorm / WAD. */
  k: bigint;
  /** Orthogonal offset contributed while the tick is a boundary tick. */
  s: bigint;
  /** Normalized plane constant in WAD. */
  kNorm: bigint;
};

function requireUsableTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK)
    throw new Error(`Unusable tick ${tick}`);
}

/** Ticks per decade of depeg distance. */
const PER_DECADE = 40;

/** The Renard R40 mantissas (ISO 3) in hundredths, as packed in OrbitalTick's R40_0..R40_2 words. */
const R40: readonly number[] = [
  100, 106, 112, 118, 125, 132, 140, 150, 160, 170, 180, 190, 200, 212, 224,
  236, 250, 265, 280, 300, 315, 335, 355, 375, 400, 425, 450, 475, 500, 530,
  560, 600, 630, 670, 710, 750, 800, 850, 900, 950,
];

/**
 * Depeg distance `1 - p` of a tick in units of 1e-8: `R40[m] * 10^q` with `(q, m) = divmod(tick, 40)`. Tick 40 is
 * 1,000 (0.1 bp), tick 120 is 100,000 (10 bp, p = 0.999), tick 238 is 90,000,000 (p = 0.10).
 */
export function tickDeviationE8(tick: number): number {
  requireUsableTick(tick);
  return R40[tick % PER_DECADE] * 10 ** Math.floor(tick / PER_DECADE);
}

/** Exact depeg reference price of a tick in X36 (OrbitalTick.priceAtTick): `1e36 - R40[m] * 10^(q + 28)`. */
export function priceAtTickX36(tick: number): bigint {
  requireUsableTick(tick);
  return (
    X36 -
    BigInt(R40[tick % PER_DECADE]) *
      10n ** BigInt(Math.floor(tick / PER_DECADE) + 28)
  );
}

/** Depeg reference price of a tick as a float, for display. */
export function priceAtTick(tick: number): number {
  return (100_000_000 - tickDeviationE8(tick)) / 100_000_000;
}

/**
 * Normalized plane constant of a tick in WAD (OrbitalTick.kNormAtTick): `sqrt3 - (p + 2) / sqrt(3 (p^2 + 2))` at the
 * tick's exact price, with the same roundings: nearest root, nearest quotient (ties up), nearest WAD rounding (ties up).
 */
export function kNormAtTick(tick: number): bigint {
  const p = priceAtTickX36(tick);
  const denominator = sqrtNearest(3n * (p * p + 2n * X72));
  const fraction = mulDivNearest(p + 2n * X36, X36, denominator);
  const kX36 = SQRT3_X36 - fraction;
  return kX36 % WAD >= WAD / 2n ? kX36 / WAD + 1n : kX36 / WAD;
}

/** Every usable tick index, 40..238. */
export const ALL_TICKS: readonly number[] = Array.from(
  { length: MAX_TICK - MIN_TICK + 1 },
  (_, i) => i + MIN_TICK,
);

/** Initialized ticks of a bitmap, ascending. */
export function initializedTicks(bitmap: bigint): number[] {
  return ALL_TICKS.filter(t => (bitmap >> BigInt(t)) & 1n);
}

/**
 * Next initialized tick at or below `tick` (`lte`), or strictly above it, or 0 when none exists
 * (OrbitalTick.nextInitializedTick).
 */
export function nextInitializedTick(
  bitmap: bigint,
  tick: number,
  lte: boolean,
): number {
  let masked: bigint;
  if (lte) {
    if (tick < MIN_TICK) return 0;
    if (tick > MAX_TICK) tick = MAX_TICK;
    masked = bitmap & ((1n << BigInt(tick + 1)) - 1n);
  } else {
    if (tick >= MAX_TICK) return 0;
    if (tick < 0) tick = 0;
    masked = bitmap & ~((1n << BigInt(tick + 1)) - 1n);
  }
  if (masked === 0n) return 0;
  return log2(lte ? masked : masked & -masked);
}
