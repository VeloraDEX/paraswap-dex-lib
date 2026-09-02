/* eslint-disable no-console */
import {
  _computeOutGivenExactIn,
  _computeInGivenExactOut,
} from '@balancer-labs/balancer-maths';
import {
  ABSOLUTE_MIN_TOKEN_BALANCE,
  calcInGivenOut,
  calcOutGivenIn,
  calcSpotPrice,
  isExactOutAllowed,
} from './rangeMath';
import { WAD, powUp, pow } from './fixedPoint';

// Deterministic LCG so the cross-check is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Weight pairs (scaled18). Includes the y==1 shortcut (50/50), y==4 region, and
// non-shortcut ratios (7/20, 20/7, 10/7) that exercise LogExpMath.
const WEIGHT_PAIRS: [bigint, bigint][] = [
  [50n * 10n ** 16n, 50n * 10n ** 16n], // 0.5 / 0.5  -> exponent 1e18 (shortcut)
  [80n * 10n ** 16n, 20n * 10n ** 16n], // 0.8 / 0.2  -> exponent 4e18 (shortcut)
  [20n * 10n ** 16n, 80n * 10n ** 16n], // 0.2 / 0.8  -> exponent 0.25e18
  [7n * 10n ** 16n, 20n * 10n ** 16n], //  0.07 / 0.20 -> non-shortcut
  [20n * 10n ** 16n, 7n * 10n ** 16n], //  0.20 / 0.07 -> non-shortcut
  [10n * 10n ** 16n, 7n * 10n ** 16n], //  0.10 / 0.07 -> non-shortcut
];

const BALANCES = [
  1_000n * WAD,
  30_000n * WAD,
  1_234_567n * WAD,
  5n * WAD,
  999_999_999n * WAD,
];

// A fact balance large enough that the cap never binds (isolates the curve math).
const HUGE_FACT = 10n ** 40n;

describe('RangeMath bit-exact vs balancer-maths reference', () => {
  it('calcOutGivenIn == _computeOutGivenExactIn (uncapped, amountIn < 30%)', () => {
    const rand = lcg(0xc0ffee);
    let checks = 0;
    for (const [wIn, wOut] of WEIGHT_PAIRS) {
      for (const vIn of BALANCES) {
        for (const vOut of BALANCES) {
          for (let i = 0; i < 8; i++) {
            // amountIn strictly under the 30% MaxInRatio so the reference doesn't throw.
            const frac = BigInt(Math.floor(rand() * 29_0000)); // up to ~29%
            const amountIn = (vIn * frac) / 100_0000n;
            if (amountIn === 0n) continue;
            const mine = calcOutGivenIn(
              vIn,
              wIn,
              vOut,
              wOut,
              amountIn,
              HUGE_FACT,
            );
            const ref = _computeOutGivenExactIn(vIn, wIn, vOut, wOut, amountIn);
            expect(mine).toEqual(ref);
            checks++;
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(500);
  });

  it('calcInGivenOut == _computeInGivenExactOut (amountOut < 30%)', () => {
    const rand = lcg(0xbeef);
    let checks = 0;
    for (const [wIn, wOut] of WEIGHT_PAIRS) {
      for (const vIn of BALANCES) {
        for (const vOut of BALANCES) {
          for (let i = 0; i < 8; i++) {
            const frac = BigInt(Math.floor(rand() * 29_0000));
            const amountOut = (vOut * frac) / 100_0000n;
            if (amountOut === 0n) continue;
            const mine = calcInGivenOut(vIn, wIn, vOut, wOut, amountOut);
            const ref = _computeInGivenExactOut(
              vIn,
              wIn,
              vOut,
              wOut,
              amountOut,
            );
            expect(mine).toEqual(ref);
            checks++;
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(500);
  });

  it('powUp matches the y==1/2/4 shortcuts and the LogExpMath path', () => {
    const x = (12n * WAD) / 10n; // 1.2
    expect(powUp(x, WAD)).toEqual(x); // shortcut y==1
    // Non-shortcut exponent goes through pow() + maxError.
    const y = (35n * WAD) / 100n; // 0.35
    const raw = pow(x, y);
    expect(powUp(x, y)).toBeGreaterThan(raw);
  });

  it('caps output at factBalanceOut - ABSOLUTE_MIN_TOKEN_BALANCE', () => {
    const wIn = 50n * 10n ** 16n;
    const wOut = 50n * 10n ** 16n;
    const vIn = 30_000n * WAD;
    const vOut = 30_000n * WAD;
    const amountIn = 10_000n * WAD;
    const smallFact = 5n * WAD; // far below the uncapped curve output
    const capped = calcOutGivenIn(vIn, wIn, vOut, wOut, amountIn, smallFact);
    expect(capped).toEqual(smallFact - ABSOLUTE_MIN_TOKEN_BALANCE);
  });

  it('isExactOutAllowed enforces fact + virtual guards', () => {
    expect(isExactOutAllowed(10n * WAD, 100n * WAD, 1000n * WAD)).toBe(true);
    // amountOut + 1e6 > factBalanceOut
    expect(isExactOutAllowed(100n * WAD, 100n * WAD, 1000n * WAD)).toBe(false);
    // amountOut >= virtualBalanceOut
    expect(isExactOutAllowed(1000n * WAD, 5000n * WAD, 1000n * WAD)).toBe(
      false,
    );
  });

  it('calcSpotPrice matches the divDown/mulDown/divDown form', () => {
    const p = calcSpotPrice(
      30_000n * WAD,
      50n * 10n ** 16n,
      1n * WAD,
      50n * 10n ** 16n,
    );
    // base/quote = 30000 with equal weights -> 30000e18
    expect(p).toEqual(30_000n * WAD);
  });
});
