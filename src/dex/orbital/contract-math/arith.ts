// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Checked uint256 arithmetic and the OrbitalMath / OpenZeppelin Math primitives on native bigint.
// BigInt never overflows nor reverts, so every operation that Solidity checks is checked here explicitly.
import {
  OrbitalQuoteError,
  PANIC_ARITHMETIC,
  PANIC_DIVISION_BY_ZERO,
  panic,
} from './errors';

export const UINT256_MAX = (1n << 256n) - 1n;
const INT256_MAX = (1n << 255n) - 1n;

/** Reverts like Solidity when a value leaves the uint256 range. */
export function u256(value: bigint): bigint {
  if (value < 0n || value > UINT256_MAX) throw panic(PANIC_ARITHMETIC);
  return value;
}

/** Checked `a - b` on uint256. */
export function sub(a: bigint, b: bigint): bigint {
  if (b > a) throw panic(PANIC_ARITHMETIC);
  return a - b;
}

/**
 * SafeCast.toInt256. Its custom error `SafeCastOverflowedUintToInt(uint256)` is a revert of the quote like any other, so
 * it is an OrbitalQuoteError (and `tryQuoteExactInput` returns null), named after the error.
 */
export function toInt256(value: bigint): bigint {
  if (value > INT256_MAX)
    throw new OrbitalQuoteError('SafeCastOverflowedUintToInt');
  return value;
}

/** Solidity division: truncates toward zero, reverts on a zero divisor. BigInt division truncates the same way. */
export function div(a: bigint, b: bigint): bigint {
  if (b === 0n) throw panic(PANIC_DIVISION_BY_ZERO);
  return a / b;
}

export function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

export function max(a: bigint, b: bigint): bigint {
  return a >= b ? a : b;
}

/** floor(a * b / denominator) with a full-precision product (Math.mulDiv). */
export function mulDivDown(a: bigint, b: bigint, denominator: bigint): bigint {
  return u256(div(a * b, denominator));
}

/** ceil(a * b / denominator) with a full-precision product (Math.mulDiv, Rounding.Ceil). */
export function mulDivUp(a: bigint, b: bigint, denominator: bigint): bigint {
  const product = a * b;
  const quotient = div(product, denominator);
  return u256(product % denominator === 0n ? quotient : quotient + 1n);
}

/** a * b / denominator rounded to nearest, ties up (OrbitalMath.mulDivNearest). */
export function mulDivNearest(
  a: bigint,
  b: bigint,
  denominator: bigint,
): bigint {
  const product = a * b;
  const quotient = div(product, denominator);
  const remainder = product % denominator;
  return u256(remainder >= denominator - remainder ? quotient + 1n : quotient);
}

/** floor(sqrt(value)) (Math.sqrt). */
export function sqrtDown(value: bigint): bigint {
  if (value < 0n) throw panic(PANIC_ARITHMETIC);
  if (value < 2n) return value;
  // Newton from a power of two above the root: strictly decreasing until it reaches floor(sqrt(value)).
  let x = 1n << BigInt((value.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + value / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** ceil(sqrt(value)) (Math.sqrt, Rounding.Ceil). */
export function sqrtUp(value: bigint): bigint {
  const root = sqrtDown(value);
  return root * root < value ? root + 1n : root;
}

/** sqrt(value) rounded to nearest (OrbitalMath.sqrtNearest). */
export function sqrtNearest(value: bigint): bigint {
  const root = sqrtDown(value);
  return value - root * root > root ? root + 1n : root;
}

/** Index of the most significant set bit (Math.log2); 0 for 0. */
export function log2(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length - 1;
}
