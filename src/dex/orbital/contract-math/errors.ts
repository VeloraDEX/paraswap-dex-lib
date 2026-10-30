// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
/** Solidity panic codes the quote path can raise. */
export const PANIC_ARITHMETIC = 0x11;
export const PANIC_DIVISION_BY_ZERO = 0x12;

/**
 * A quote the pool would refuse. `reason` is the exact on-chain revert string (`"Seed limit"`, `"Output too small"`…),
 * or `"Panic(0x11)"` / `"Panic(0x12)"` for a checked-arithmetic or division-by-zero panic.
 */
export class OrbitalQuoteError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Orbital quote reverted: ${reason}`);
    this.name = 'OrbitalQuoteError';
    this.reason = reason;
  }
}

export function panic(code: number): OrbitalQuoteError {
  return new OrbitalQuoteError(`Panic(0x${code.toString(16)})`);
}

/** Solidity `require(condition, reason)`. */
export function check(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new OrbitalQuoteError(reason);
}
