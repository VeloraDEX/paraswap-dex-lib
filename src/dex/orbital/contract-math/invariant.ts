// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Port of src/libraries/OrbitalInvariant.sol: certifies on which side of one partition's surface a point lies.
import { absDiff, max, sqrtDown, sub, toInt256 } from './arith';
import { SQRT3_X36, X36 } from './constants';

/** Side of a reserve point relative to one partition's surface. */
export const Side = {
  /** Not certified on the pool side: certified outside or ambiguous. */
  Outside: 0,
  /** Certified on or inside the surface, on the physical branch. */
  Inside: 1,
  /** Strictly inside the orthogonal offset ||w|| < sBound: on the pool side, but not a valid state. */
  Inner: 2,
} as const;
export type Side = (typeof Side)[keyof typeof Side];

/** One partition's circle in the (alpha, ||w||) plane. */
export type Circle = {
  rInt: bigint;
  kBound: bigint;
  sBound: bigint;
  /** floor and ceil of the axial center kBound + rInt * sqrt3. */
  centerLo: bigint;
  centerHi: bigint;
  /** rInt^2. */
  radius2: bigint;
};

/** Certification of one reserve point. */
export type Position = {
  side: Side;
  /** Upper bound of the outward residual interval (torus only); zero for an Inner point. */
  residual: bigint;
  /** Upper bound of |alpha - center| (torus only). */
  axial: bigint;
  /** Upper bound of ||w|| - sBound (torus only). */
  radial: bigint;
  /** floor(||w||) (torus only). */
  wLo: bigint;
};

/** OrbitalInvariant.circle. */
export function circle(rInt: bigint, kBound: bigint, sBound: bigint): Circle {
  const scaled = rInt * SQRT3_X36;
  const centerLo = kBound + scaled / X36;
  return {
    rInt,
    kBound,
    sBound,
    centerLo,
    centerHi: scaled % X36 === 0n ? centerLo : centerLo + 1n,
    radius2: rInt ** 2n,
  };
}

/** OrbitalInvariant.locate: whether a point with sum `sum` and square sum `squares` is on or inside the surface. */
export function locate(c: Circle, sum: bigint, squares: bigint): Position {
  const p: Position = {
    side: Side.Outside as Side,
    residual: 0n,
    axial: 0n,
    radial: 0n,
    wLo: 0n,
  };

  // Sphere: Q + 2R^2 <= 2RS, exact.
  if (c.kBound === 0n && c.sBound === 0n) {
    p.side =
      squares + 2n * c.radius2 <= 2n * c.rInt * sum
        ? Side.Inside
        : Side.Outside;
    return p;
  }

  // Torus, 1. Inner: wLo = floor(sqrt(floor(N / 3))) with N = 3Q - S^2.
  const numerator = sub(3n * squares, sum ** 2n);
  p.wLo = sqrtDown(numerator / 3n);
  if (p.wLo < c.sBound) {
    p.side = Side.Inner;
    return p;
  }

  // Torus, 2. Box around the true point.
  const wHi = 3n * p.wLo ** 2n === numerator ? p.wLo : p.wLo + 1n;
  const scaledSum = sum * X36;
  const alphaLo = scaledSum / SQRT3_X36;
  const alphaHi = scaledSum % SQRT3_X36 === 0n ? alphaLo : alphaLo + 1n;

  // Torus, 3. Farthest corner against rInt^2.
  p.axial = max(absDiff(alphaLo, c.centerHi), absDiff(alphaHi, c.centerLo));
  p.radial = wHi - c.sBound;
  const upper = p.axial ** 2n + p.radial ** 2n;
  p.side = upper <= c.radius2 ? Side.Inside : Side.Outside;
  p.residual = toInt256(upper) - toInt256(c.radius2);
  return p;
}
