import vectorsFile from '../fixtures/mev-capture-v21/quoter-vectors.json';
import anchorUpdatesFile from '../fixtures/mev-capture-v21/anchor-updates.json';
import {
  CoreState,
  CoreTickSearch,
  InitializedTick,
  isValidSqrtRatio,
  MevCaptureV21QuoteError,
  predSqrtRatio,
  sqrtRatioFromRaw,
  sqrtRatioToRaw,
  succSqrtRatio,
} from './mev-capture-v21-core';
import {
  MevCaptureV21Anchor,
  MevCaptureV21Config,
  MevCaptureV21Model,
  MevCaptureV21PoolModel,
} from './mev-capture-v21';
import { floatSqrtRatioToFixed } from './sqrt-ratio';

type Json = any;

const S = 4096;
const L66 = 1n << 66n;

// Positions minted by the contract test that produced each vector
// (`test_vectors_*` in evm-contracts test/extensions/MEVCaptureV21Rules.t.sol).
// The vectors carry the pool state but not the positions.
const WIDE: [number, number, bigint] = [-40 * S, 40 * S, L66];
const POSITIONS: Record<string, [number, number, bigint][]> = {};
const layout = (names: string[], positions: [number, number, bigint][]) => {
  for (const name of names) POSITIONS[name] = positions;
};
layout(
  [
    'inc_exact_in_cut_bridge_rate',
    'dec_toward_then_away_exact_in',
    'inc_exact_out_after_anchor_update',
    'dec_exact_out_partial',
    'inc_exact_in_partial_mid_segment',
  ],
  [WIDE, [3 * S, 7 * S, L66], [-7 * S, -3 * S, L66]],
);
layout(
  [
    'exact_tick_state_dec_from_tick_T',
    'inc_through_T_toward_uncut',
    'dec_onto_T_tick_T_minus_1',
    'exact_tick_state_inc_from_tick_T_minus_1',
    'dec_onto_T_again',
    'fee_only_1_wei_exact_in_at_T',
  ],
  [WIDE, [3 * S, 7 * S, L66]],
);
layout(
  [
    'bridge_25pct_exact_in',
    'bridge_25pct_exact_out_dec',
    'bridge_1ulp_exact_in',
  ],
  [WIDE, [2 * S, 3 * S, L66]],
);
layout(
  ['empty_words_skip0', 'return_toward_skip0', 'empty_words_skip3'],
  [
    [-S, S, L66],
    [1000 * S, 1001 * S, L66],
  ],
);
layout(
  ['cap_tail_to_max'],
  [
    [-20_000 * S, 20_000 * S, 1n << 40n],
    [3000 * S, 3001 * S, 1_000_000_000n],
  ],
);
layout(
  ['segexp2_offgrid_ticks_inc'],
  [WIDE, [3 * S, 7 * S, L66 * 2n], [8 * S, 9 * S, L66]],
);
layout(
  ['spacing3000_negative_anchor_dec', 'spacing3000_negative_anchor_inc'],
  [
    [-200 * 3000, 100 * 3000, L66],
    [-50 * 3000, -30 * 3000, L66],
  ],
);

function ticksOf(positions: [number, number, bigint][]): InitializedTick[] {
  const net = new Map<number, bigint>();
  for (const [lo, hi, l] of positions) {
    net.set(lo, (net.get(lo) ?? 0n) + l);
    net.set(hi, (net.get(hi) ?? 0n) - l);
  }
  return [...net.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, liquidityDelta]) => ({ number, liquidityDelta }));
}

const coreState = (v: Json): CoreState => ({
  sqrtRatio: sqrtRatioFromRaw(BigInt(v.sqrtRatio)),
  tick: Number(v.tick),
  liquidity: BigInt(v.liquidity),
});

const vectorConfig = (c: Json): MevCaptureV21Config => ({
  halfLife: Number(c.tau),
  slopeK: Number(c.slopeK),
  segmentExp: Number(c.segExp),
  jLin: Number(c.jLin),
  maxFee: BigInt(c.maxFee),
  clampTicks: Number(c.clampTicks),
  mGate: Number(c.mGate),
});

function vectorPool(v: Json): MevCaptureV21PoolModel {
  const positions = POSITIONS[v.name];
  if (!positions) throw new Error(`no position layout for ${v.name}`);
  return new MevCaptureV21PoolModel(
    vectorConfig(v.cfg),
    BigInt(v.pool.fee),
    Number(v.pool.tickSpacing),
    ticksOf(positions),
  );
}

describe('MEVCapture v2.1 contract vectors', () => {
  const vectors: Json[] = (vectorsFile as Json).vectors;

  test('replay every Core call exactly', () => {
    expect(vectors.length).toBe(21);
    let callsChecked = 0;
    const coverage = { exactIn: 0, exactOut: 0, token0: 0, token1: 0, skip: 0 };

    for (const v of vectors) {
      const p = v.params;
      const params = {
        isToken1: p.isToken1 as boolean,
        amount: BigInt(p.amount),
        sqrtRatioLimit: sqrtRatioFromRaw(BigInt(p.sqrtRatioLimit)),
        skipAhead: Number(p.skipAhead),
      };
      coverage[params.amount < 0n ? 'exactOut' : 'exactIn']++;
      coverage[params.isToken1 ? 'token1' : 'token0']++;
      if (params.skipAhead !== 0) coverage.skip++;

      const swap = vectorPool(v).swapThroughSegments(
        coreState(v.before),
        params,
        BigInt(v.anchorX16),
      );

      const actual = swap.calls.map(c => ({
        limit: sqrtRatioToRaw(c.sqrtRatioLimit),
        amount: c.amount,
        kind: c.kind.kind,
        surcharge: c.kind.kind === 'charged' ? c.kind.surcharge : 0n,
        before: c.stateBefore,
        after: c.stateAfter,
        delta0: c.delta0,
        delta1: c.delta1,
        fee0: c.surcharge0,
        fee1: c.surcharge1,
      }));
      const expected = (v.calls as Json[]).map(e => ({
        limit: BigInt(e.limit),
        amount: BigInt(e.amount),
        kind: e.kind,
        surcharge: BigInt(e.surcharge),
        before: coreState(e.before),
        after: coreState(e.after),
        delta0: BigInt(e.delta0),
        delta1: BigInt(e.delta1),
        fee0: BigInt(e.fee0),
        fee1: BigInt(e.fee1),
      }));
      expect({ name: v.name, calls: actual }).toEqual({
        name: v.name,
        calls: expected,
      });
      callsChecked += actual.length;

      expect({
        name: v.name,
        delta0: swap.delta0,
        delta1: swap.delta1,
        after: swap.coreStateAfter,
      }).toEqual({
        name: v.name,
        delta0: BigInt(v.total.delta0),
        delta1: BigInt(v.total.delta1),
        after: coreState(v.after),
      });

      const surcharges = swap.calls.reduce(
        (sum, c) => sum + c.surcharge0 + c.surcharge1,
        0n,
      );
      expect(swap.surcharge0 + swap.surcharge1).toBe(surcharges);
      expect(swap.resources.coreCalls).toBe(actual.length);
      expect(swap.resources.accumulateAsFees).toBe(
        (v.calls as Json[]).filter(e => BigInt(e.fee0) + BigInt(e.fee1) > 0n)
          .length,
      );
    }

    expect(callsChecked).toBe(266);
    for (const n of Object.values(coverage)) expect(n).toBeGreaterThan(0);
  });

  test('surcharges are only charged on the calculated token of charged calls', () => {
    for (const v of vectors) {
      for (const e of v.calls as Json[]) {
        const [f0, f1] = [BigInt(e.fee0), BigInt(e.fee1)];
        if (e.kind !== 'charged') expect(f0 + f1).toBe(0n);
        expect(v.params.isToken1 ? f1 : f0).toBe(0n);
      }
    }
  });

  test('a quote at the anchor update timestamp runs the segments only', () => {
    const v = vectors.find(x => x.name === 'inc_exact_in_cut_bridge_rate');
    const pool = vectorPool(v);
    const core = coreState(v.before);
    const anchor = pool.model.initialize(core.tick, 1);
    const amount = 1_000_000_000_000_000_000n;

    const same = pool.simulateSwap(core, anchor, { isToken1: true, amount }, 1);
    const direct = pool.swapThroughSegments(
      core,
      { isToken1: true, amount },
      anchor.anchorX16,
    );
    expect(same.delta0).toBe(direct.delta0);
    expect(same.delta1).toBe(direct.delta1);
    expect(same.resources.anchorUpdates).toBe(0);
    expect(direct.surcharge0 > 0n).toBe(true);

    const later = pool.simulateSwap(
      core,
      anchor,
      { isToken1: true, amount },
      13,
    );
    expect(later.resources.anchorUpdates).toBe(1);
    expect(later.anchorAfter.lastUpdateTime).toBe(13);
    // the input state is not mutated
    expect(anchor.lastUpdateTime).toBe(1);
  });
});

describe('MEVCapture v2.1 sqrt ratio helpers', () => {
  test('raw encoding matches the pool state decoding', () => {
    for (const v of (vectorsFile as Json).vectors as Json[]) {
      const raw = BigInt(v.before.sqrtRatio);
      expect(sqrtRatioFromRaw(raw)).toBe(floatSqrtRatioToFixed(raw));
    }
  });

  test('pred and succ cross regions', () => {
    for (const raw of [
      (1n << 94n) | (1n << 62n),
      (2n << 94n) | (1n << 62n),
      (3n << 94n) | (1n << 62n),
      1n << 63n,
    ]) {
      const x = sqrtRatioFromRaw(raw);
      expect(succSqrtRatio(predSqrtRatio(x))).toBe(x);
      expect(predSqrtRatio(x) < x).toBe(true);
      expect(isValidSqrtRatio(predSqrtRatio(x))).toBe(true);
      expect(succSqrtRatio(x) > x).toBe(true);
      expect(isValidSqrtRatio(succSqrtRatio(x))).toBe(true);
      expect(sqrtRatioToRaw(x)).toBe(raw);
    }
  });
});

describe('MEVCapture v2.1 tick search bounds', () => {
  const ticks = ticksOf([[-S, S, L66]]);

  test('searches that stay within the known range succeed', () => {
    const search = new CoreTickSearch(ticks, S, 0, [-300 * S, 300 * S]);
    expect(search.next(0)).toEqual({ tick: S, index: 1 });
    expect(search.prev(0)).toEqual({ tick: -S, index: 0 });
  });

  test('a search that could miss an unknown tick fails', () => {
    // the word above tick S ends at 255 spacings past the word start
    const search = new CoreTickSearch(ticks, S, 0, [-2 * S, 2 * S]);
    expect(() => search.next(S)).toThrow(MevCaptureV21QuoteError);
    expect(() => search.prev(-S - 1)).toThrow(MevCaptureV21QuoteError);
  });

  test('a swap past the known range fails instead of guessing', () => {
    const config: MevCaptureV21Config = {
      halfLife: 120,
      slopeK: 4,
      segmentExp: 0,
      jLin: 16,
      maxFee: 1n << 63n,
      clampTicks: 2500,
      mGate: 3,
    };
    const pool = new MevCaptureV21PoolModel(config, 1n << 60n, S, ticks, [
      -2 * S,
      2 * S,
    ]);
    const core = { sqrtRatio: 1n << 128n, tick: 0, liquidity: L66 };
    expect(() =>
      pool.swapThroughSegments(
        core,
        { isToken1: true, amount: 1n << 100n },
        0n,
      ),
    ).toThrow(MevCaptureV21QuoteError);
  });
});

const anchor = (v: Json): MevCaptureV21Anchor => ({
  lastUpdateTime: Number(v.lastUpdateTime),
  lRefTime: Number(v.lRefTime),
  lastPosTime: Number(v.lastPosTime),
  lRefBits: Number(v.lRefBits),
  snapBits: Number(v.snapBits),
  lRefRaiseTime: Number(v.lRefRaiseTime),
  anchorX16: BigInt(v.anchorX16),
});

describe('MEVCapture v2.1 anchor state machine', () => {
  test('anchor updates replay all seven fields', () => {
    const v = anchorUpdatesFile as Json;
    const c = v.config;
    // the fixture expresses fees as 0.16 numbers
    const m = new MevCaptureV21Model({
      halfLife: Number(c.halfLife),
      slopeK: Number(c.slopeK),
      segmentExp: Number(c.segmentExp),
      jLin: Number(c.jLin),
      maxFee: BigInt(c.maxFee) << 48n,
      clampTicks: Number(c.clampTicks),
      mGate: Number(c.mGate),
    });
    expect(v.anchorUpdates.length).toBe(120);
    const halfLife = BigInt(m.config.halfLife);
    const clamp = BigInt(m.config.clampTicks);
    let roundedUp = 0;
    (v.anchorUpdates as Json[]).forEach((u, i) => {
      const stateIn = anchor(u.stateIn);
      const expected = anchor(u.expected);
      const now = Number(u.timestamp);
      // The fixture comes from the variant whose movement allowance floors;
      // the deployed extension rounds it up, which moves the anchor by one
      // more unit exactly when the floored allowance was binding.
      const elapsed = BigInt((now - stateIn.lastUpdateTime) >>> 0);
      const dt = elapsed < halfLife ? elapsed : halfLife;
      const floored = ((clamp << 16n) * dt) / halfLife;
      const move = expected.anchorX16 - stateIn.anchorX16;
      const absMove = move < 0n ? -move : move;
      if (
        u.passed &&
        ((clamp << 16n) * dt) % halfLife !== 0n &&
        absMove === floored
      ) {
        expected.anchorX16 += move < 0n ? -1n : 1n;
        roundedUp++;
      }
      const state = { ...stateIn };
      const gate = m.beforeSwap(
        state,
        Number(u.tick),
        BigInt(u.liquidity),
        now,
      );
      expect({ i, gate, state }).toEqual({
        i,
        gate: { passed: u.passed, lObs: Number(u.lObs), eRef: Number(u.eRef) },
        state: expected,
      });
    });
    expect(roundedUp).toBeGreaterThan(0);
  });

  const displaced = (): MevCaptureV21Anchor => ({
    lastUpdateTime: 0,
    lRefTime: 0,
    lastPosTime: 0,
    lRefBits: 0,
    snapBits: 0,
    lRefRaiseTime: 0,
    anchorX16: 0n,
  });
  const clampModel = (halfLife: number, clampTicks: number) =>
    new MevCaptureV21Model({
      halfLife,
      slopeK: 4,
      segmentExp: 0,
      jLin: 16,
      maxFee: 1n << 63n,
      clampTicks,
      mGate: 3,
    });
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

  test('per-second updates cannot freeze the anchor', () => {
    const m = clampModel(1 << 20, 1);
    const touched = displaced();
    for (let i = 1; i <= 32; i++) {
      m.beforeSwap(touched, 1000, L66, i);
      expect(touched.lastUpdateTime).toBe(i);
      expect(touched.anchorX16).toBe(BigInt(i));
    }
    const single = displaced();
    m.beforeSwap(single, 1000, L66, 32);
    expect(single.anchorX16).toBe(2n);
  });

  test('the movement allowance rounds up', () => {
    const m = clampModel(120, 2500);
    const state = displaced();
    m.beforeSwap(state, 1_000_000, L66, 7);
    expect(state.anchorX16).toBe(ceilDiv((2500n << 16n) * 7n, 120n));
  });
});
