import {
  mevCaptureV21GasCost,
  MevCaptureV21PoolState,
  quoteMevCaptureV21,
} from './mev-capture-v21';
import { MevCaptureV21Model } from './math/mev-capture-v21';
import { ConcentratedPoolTypeConfig, PoolConfig, PoolKey } from './utils';

const SPACING = 100;
const L = 1n << 72n;
const config = {
  halfLife: 120,
  slopeK: 4,
  segmentExp: 0,
  jLin: 16,
  maxFee: 1n << 63n,
  clampTicks: 2500,
  mGate: 3,
};
const key = new PoolKey(
  1n,
  2n,
  new PoolConfig(
    1n,
    9223372036854775n,
    new ConcentratedPoolTypeConfig(SPACING),
  ),
);

function state(
  bounds: [number, number],
  blockTimestamp = 1000,
): MevCaptureV21PoolState.Object {
  return {
    sqrtRatio: 1n << 128n,
    tick: 0,
    liquidity: L,
    sortedTicks: [
      { number: -400 * SPACING, liquidityDelta: L },
      { number: 400 * SPACING, liquidityDelta: -L },
    ],
    checkedTicksBounds: bounds,
    config,
    anchor: new MevCaptureV21Model(config).initialize(0, blockTimestamp),
    blockTimestamp,
    tvl: [0n, 0n],
  };
}

describe(quoteMevCaptureV21, () => {
  test('an away swap is charged in several Core calls', () => {
    const s = state([-256_000, 256_000]);
    const amount = 10n ** 19n;
    const q = quoteMevCaptureV21(key, amount, false, s, 1012);
    expect(q.consumedAmount).toBe(amount);
    expect(q.resources!.coreCalls).toBeGreaterThan(1);
    expect(q.resources!.accumulateAsFees).toBeGreaterThan(0);
    expect(q.resources!.anchorUpdates).toBe(1);
    expect(q.gasConsumed).toBe(mevCaptureV21GasCost(q.resources!));
    expect(q.skipAhead).toBe(0);

    // no anchor update when the state's timestamp is the swap's
    const sameTimestamp = quoteMevCaptureV21(key, amount, false, s, 1000);
    expect(sameTimestamp.resources!.anchorUpdates).toBe(0);
  });

  test('exact output', () => {
    const s = state([-256_000, 256_000]);
    const q = quoteMevCaptureV21(key, -(10n ** 18n), true, s, 1012);
    expect(q.consumedAmount).toBe(-(10n ** 18n));
    expect(q.calculatedAmount > 10n ** 18n).toBe(true);
  });

  test('reports nothing filled past the fetched ticks', () => {
    const s = state([-1000, 1000]);
    const q = quoteMevCaptureV21(key, 10n ** 21n, false, s, 1012);
    expect(q.consumedAmount).toBe(0n);
    expect(q.calculatedAmount).toBe(0n);
  });
});
