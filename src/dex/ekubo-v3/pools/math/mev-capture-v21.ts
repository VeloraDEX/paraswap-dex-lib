// Off-chain model of the MEVCapture v2.1 extension (`main` variant,
// EkuboProtocol/evm-contracts src/extensions/MEVCaptureV21.sol): the anchor
// state machine and the forwarded swap, which the extension executes as a
// sequence of `Core.swap` calls (an uncharged call toward the anchor, then
// away segments charged a surcharge through `accumulateAsFees`).
import { exp2 } from './twamm/exp2';
import { MAX_SQRT_RATIO, MAX_TICK, MIN_SQRT_RATIO, MIN_TICK } from './tick';
import {
  amountBeforeFee,
  checkedI128,
  computeFee,
  CoreState,
  coreSwap,
  CoreTickSearch,
  InitializedTick,
  isValidSqrtRatio,
  MevCaptureV21QuoteError,
  predSqrtRatio,
  succSqrtRatio,
  TickEvent,
  tickToSqrtRatio,
} from './mev-capture-v21-core';

const MAX_U128 = (1n << 128n) - 1n;

/** The extension's `getConfig()`, without the derived `segmentWidthMultiplier`. */
export interface MevCaptureV21Config {
  halfLife: number;
  slopeK: number;
  segmentExp: number;
  jLin: number;
  /** 0.64 fixed point, like the pool fee. */
  maxFee: bigint;
  clampTicks: number;
  mGate: number;
}

/** The extension's `getAnchor(poolId)`. Times are uint32 seconds. */
export interface MevCaptureV21Anchor {
  lastUpdateTime: number;
  lRefTime: number;
  lastPosTime: number;
  lRefBits: number;
  snapBits: number;
  lRefRaiseTime: number;
  anchorX16: bigint;
}

/** First-touch gate result; a failure is the `AnchorGateFailed(poolId, lObs, eRef)` event. */
export interface MevCaptureV21Gate {
  passed: boolean;
  lObs: number;
  eRef: number;
}

const isUint = (x: number, max: number) =>
  Number.isInteger(x) && x >= 0 && x <= max;

/** The extension constructor's checks. */
export function validateMevCaptureV21Config(
  c: MevCaptureV21Config,
): MevCaptureV21Config {
  const ranges: [number, number, number][] = [
    [c.halfLife, 1, 1 << 20],
    [c.slopeK, 1, 16],
    [c.segmentExp, 0, 8],
    [c.jLin, 1, 64],
    [c.clampTicks, 1, 2 * MAX_TICK],
    [c.mGate, 0, 16],
  ];
  const valid =
    ranges.every(([x, min, max]) => isUint(x, max) && x >= min) &&
    typeof c.maxFee === 'bigint' &&
    c.maxFee > 0n &&
    c.maxFee <= 1n << 63n;
  if (!valid) throw new RangeError('MEVCaptureV21: invalid configuration');
  return { ...c };
}

const sub32 = (a: number, b: number) => (a - b) >>> 0;

function bitLength(x: bigint): number {
  return x === 0n ? 0 : x.toString(2).length;
}

/** The anchor state machine of the extension for a given configuration. */
export class MevCaptureV21Model {
  public readonly config: MevCaptureV21Config;

  public constructor(config: MevCaptureV21Config) {
    this.config = validateMevCaptureV21Config(config);
  }

  /** `beforeInitializePool`. */
  public initialize(tick: number, now: number): MevCaptureV21Anchor {
    return {
      lastUpdateTime: now,
      lRefTime: now,
      lastPosTime: 0,
      lRefBits: 0,
      snapBits: 0,
      lRefRaiseTime: sub32(now, this.config.halfLife),
      anchorX16: BigInt(tick) << 16n,
    };
  }

  /** `beforeUpdatePosition`: snapshot of the active liquidity, once per timestamp. Mutates `state`. */
  public beforePosition(
    state: MevCaptureV21Anchor,
    liquidity: bigint,
    now: number,
  ): void {
    if (state.lastPosTime !== now) {
      state.lastPosTime = now;
      state.snapBits = bitLength(liquidity);
    }
  }

  private decayedReference(state: MevCaptureV21Anchor, now: number): number {
    const decay = Math.floor(sub32(now, state.lRefTime) / this.config.halfLife);
    return Math.max(0, state.lRefBits - decay);
  }

  private raise(
    base: number,
    observed: number,
    now: number,
    raiseTime: number,
  ): [number, number] {
    if (observed > base && sub32(now, raiseTime) >= this.config.halfLife)
      return [base + 1, now];
    return [base, raiseTime];
  }

  // The anchor moves toward the current tick, clamped by the allowance.
  private moveAnchor(anchorX16: bigint, tick: number, dt: number): bigint {
    const { halfLife, clampTicks } = this.config;
    const offset = anchorX16 - (BigInt(tick) << 16n);
    const halvings = Math.floor(dt / halfLife);
    const abs = offset < 0n ? -offset : offset;
    const shifted = halvings >= 128 ? 0n : abs >> BigInt(halvings);
    const fraction = (BigInt(dt % halfLife) << 64n) / BigInt(halfLife);
    const magnitude = (shifted << 64n) / exp2(fraction);
    const decayed = offset < 0n ? -magnitude : magnitude;
    // The allowance rounds up, so every update that consumes elapsed time
    // grants at least one 2^-16 tick.
    const hl = BigInt(halfLife);
    const limit =
      ((BigInt(clampTicks) << 16n) * BigInt(Math.min(dt, halfLife)) + hl - 1n) /
      hl;
    const move = decayed - offset;
    return anchorX16 + (move > limit ? limit : move < -limit ? -limit : move);
  }

  /** `_anchorUpdate`, run only on the first swap of a timestamp; `null` otherwise. Mutates `state`. */
  public beforeSwap(
    state: MevCaptureV21Anchor,
    tick: number,
    liquidity: bigint,
    now: number,
  ): MevCaptureV21Gate | null {
    if (state.lastUpdateTime === now) return null;
    const dt = sub32(now, state.lastUpdateTime);
    const lObs =
      state.lastPosTime === now ? state.snapBits : bitLength(liquidity);
    const eRef = this.decayedReference(state, now);
    const passed = lObs + this.config.mGate >= eRef;
    if (passed) {
      state.anchorX16 = this.moveAnchor(state.anchorX16, tick, dt);
      const base = Math.max(eRef, Math.min(state.lRefBits, lObs));
      [state.lRefBits, state.lRefRaiseTime] = this.raise(
        base,
        lObs,
        now,
        state.lRefRaiseTime,
      );
      state.lRefTime = now;
    }
    state.lastUpdateTime = now;
    return { passed, lObs, eRef };
  }

  /** `_refresh`: raises the reference from the liquidity after the swap. Mutates `state`. */
  public afterSwap(
    state: MevCaptureV21Anchor,
    liquidity: bigint,
    now: number,
  ): void {
    if (state.lastPosTime === now) return;
    const e = this.decayedReference(state, now);
    const [raised, raiseTime] = this.raise(
      e,
      bitLength(liquidity),
      now,
      state.lRefRaiseTime,
    );
    if (raised !== e) {
      state.lRefBits = raised;
      state.lRefTime = now;
      state.lRefRaiseTime = raiseTime;
    }
  }
}

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

// Away segments in mirrored Q16 tick coordinates (the swap always moves toward larger values).
class Grid {
  public readonly w16: bigint;
  public readonly g1: bigint;
  public readonly gJ: bigint;
  public readonly jLin: number;

  public constructor(a: bigint, spacing: number, config: MevCaptureV21Config) {
    this.w16 = BigInt(spacing) << BigInt(config.segmentExp + 16);
    this.g1 = (floorDiv(a, this.w16) + 1n) * this.w16;
    this.gJ = this.g1 + BigInt(config.jLin - 1) * this.w16;
    this.jLin = config.jLin;
  }

  public boundary(k: number): bigint {
    if (k <= this.jLin) return this.g1 + BigInt(k - 1) * this.w16;
    return this.gJ + ((1n << BigInt(k - this.jLin + 1)) - 2n) * this.w16;
  }

  public firstSegment(p: bigint): number {
    const p16 = p << 16n;
    if (p16 < this.g1) return 1;
    if (p16 < this.gJ) return Number((p16 - this.g1) / this.w16 + 2n);
    return this.jLin - 1 + bitLength((p16 - this.gJ) / this.w16 + 2n);
  }
}

function surcharge(
  config: MevCaptureV21Config,
  poolFee: bigint,
  twiceMidX16: bigint,
  spacing: number,
) {
  const den = BigInt(spacing) << 18n;
  const sur = (BigInt(config.slopeK) * poolFee * twiceMidX16 + den - 1n) / den;
  const cap = config.maxFee - poolFee;
  return sur > cap ? cap : sur;
}

/** Execution resources of one forwarded swap. */
export interface MevCaptureV21Resources {
  /** `Core.swap` calls made by the extension. */
  coreCalls: number;
  /** Core swap loop iterations, summed over calls. */
  coreSteps: number;
  initializedTicksCrossed: number;
  bridges: number;
  /** Tick-event searches by the extension itself. */
  tickEventSearches: number;
  /** `Core.accumulateAsFees` calls. */
  accumulateAsFees: number;
  /** 1 when this swap runs the first-touch anchor update of its timestamp. */
  anchorUpdates: number;
  /** 1 when the extension writes its pool state. */
  stateWrites: number;
}

export type MevCaptureV21CallKind =
  /** Zero amount or price already at the user limit: the user's parameters are forwarded. */
  | { kind: 'passThrough' }
  /** The uncut, uncharged call toward the anchor. */
  | { kind: 'toward' }
  /** A call in away segment `k` (1-based), charged `surcharge` (0.64) on the calculated token. */
  | { kind: 'charged'; k: number; surcharge: bigint }
  /** One representable step onto an initialized tick, uncharged. */
  | { kind: 'bridge' };

/** One `Core.swap` call, with the exact parameters the extension passes. */
export interface MevCaptureV21CoreCall {
  kind: MevCaptureV21CallKind;
  sqrtRatioLimit: bigint;
  /** The remaining specified amount passed to Core. */
  amount: bigint;
  /** Core's balance update (positive: paid to the pool). */
  delta0: bigint;
  delta1: bigint;
  /** Surcharge passed to `accumulateAsFees` right after the call (zero: not called). */
  surcharge0: bigint;
  surcharge1: bigint;
  /** LP fees paid inside Core (pool fee). */
  feesPaid: bigint;
  stateBefore: CoreState;
  stateAfter: CoreState;
  steps: number;
  initializedTicksCrossed: number;
}

export interface MevCaptureV21SwapParams {
  isToken1: boolean;
  /** Positive for exact input, negative for exact output. */
  amount: bigint;
  /** Fixed-point limit; omitted is the minimum or maximum sqrt ratio. */
  sqrtRatioLimit?: bigint;
  skipAhead?: number;
}

/** The Core calls of one forwarded swap with a given anchor. */
export interface MevCaptureV21SegmentSwap {
  /** The anchor the swap used. */
  anchorX16: bigint;
  calls: MevCaptureV21CoreCall[];
  /** The forwarded balance update (Core deltas plus surcharges). */
  delta0: bigint;
  delta1: bigint;
  surcharge0: bigint;
  surcharge1: bigint;
  feesPaid: bigint;
  coreStateAfter: CoreState;
  resources: MevCaptureV21Resources;
}

/** Full simulation of one forwarded swap. */
export interface MevCaptureV21Swap extends MevCaptureV21SegmentSwap {
  gate: MevCaptureV21Gate | null;
  anchorAfter: MevCaptureV21Anchor;
}

const nearer = (increasing: boolean, x: bigint, y: bigint) =>
  increasing === x < y ? x : y;

interface SegmentRun {
  params: Required<MevCaptureV21SwapParams>;
  increasing: boolean;
  exactOut: boolean;
  search: CoreTickSearch;
  current: CoreState;
  remaining: bigint;
  calls: MevCaptureV21CoreCall[];
  tickEventSearches: number;
}

/**
 * A concentrated pool behind MEVCapture v2.1. Quotes are exact for the given
 * initialized ticks, which must contain every initialized tick (including
 * ones whose net delta is zero) within `tickBounds`; a swap that would need
 * Core to search outside them fails with `TickRangeExceeded`.
 */
export class MevCaptureV21PoolModel {
  public readonly model: MevCaptureV21Model;

  public constructor(
    config: MevCaptureV21Config,
    public readonly poolFee: bigint,
    public readonly tickSpacing: number,
    public readonly ticks: readonly InitializedTick[],
    public readonly tickBounds: readonly [number, number] = [
      MIN_TICK,
      MAX_TICK,
    ],
  ) {
    this.model = new MevCaptureV21Model(config);
    if (poolFee <= 0n || poolFee >= this.model.config.maxFee) {
      throw new RangeError(
        'MEVCaptureV21: pool fee must be non-zero and below maxFee',
      );
    }
    if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
      throw new RangeError('MEVCaptureV21: invalid tick spacing');
    }
  }

  /**
   * Simulates `Core.forward(extension, abi.encode(poolKey, params))` at block
   * timestamp `now`: the first-touch anchor update, the toward call, the away
   * segments (rate cuts, tick cuts, bridges, surcharges) and the refresh.
   */
  public simulateSwap(
    core: CoreState,
    anchor: MevCaptureV21Anchor,
    params: MevCaptureV21SwapParams,
    now: number,
  ): MevCaptureV21Swap {
    const anchorAfter = { ...anchor };
    const gate = this.model.beforeSwap(
      anchorAfter,
      core.tick,
      core.liquidity,
      now,
    );
    const swap = this.swapThroughSegments(core, params, anchorAfter.anchorX16);
    this.model.afterSwap(anchorAfter, swap.coreStateAfter.liquidity, now);
    swap.resources.anchorUpdates = gate === null ? 0 : 1;
    swap.resources.stateWrites = anchorEquals(anchorAfter, anchor) ? 0 : 1;
    return { ...swap, gate, anchorAfter };
  }

  /** `_swapThroughSegments` with a given anchor (no anchor update or refresh). */
  public swapThroughSegments(
    core: CoreState,
    params: MevCaptureV21SwapParams,
    anchorX16: bigint,
  ): MevCaptureV21SegmentSwap {
    const run = this.startRun(core, params);
    const userLimit = run.params.sqrtRatioLimit;
    if (run.remaining === 0n || run.current.sqrtRatio === userLimit) {
      this.call(run, { kind: 'passThrough' }, userLimit);
    } else if (!this.toward(run, anchorX16)) {
      this.away(run, anchorX16);
    }
    return this.summarize(run, anchorX16);
  }

  private startRun(
    core: CoreState,
    params: MevCaptureV21SwapParams,
  ): SegmentRun {
    const exactOut = params.amount < 0n;
    const increasing = params.isToken1 !== exactOut;
    const sqrtRatioLimit =
      params.sqrtRatioLimit ?? (increasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO);
    if (!isValidSqrtRatio(sqrtRatioLimit)) {
      throw new MevCaptureV21QuoteError('InvalidSqrtRatioLimit');
    }
    checkedI128(params.amount);
    const skipAhead = params.skipAhead ?? 0;
    return {
      params: {
        isToken1: params.isToken1,
        amount: params.amount,
        sqrtRatioLimit,
        skipAhead,
      },
      increasing,
      exactOut,
      search: new CoreTickSearch(
        this.ticks,
        this.tickSpacing,
        skipAhead,
        this.tickBounds,
      ),
      current: { ...core },
      remaining: params.amount,
      calls: [],
      tickEventSearches: 0,
    };
  }

  // The uncut, uncharged call toward the anchor; returns whether the swap is finished.
  private toward(run: SegmentRun, anchorX16: bigint): boolean {
    const { increasing } = run;
    // floor of the mirrored anchor, mapped back: a ceiling when decreasing
    const mirroredTick = increasing ? anchorX16 >> 16n : -(-anchorX16 >> 16n);
    const anchorTick = Math.min(
      MAX_TICK,
      Math.max(MIN_TICK, Number(mirroredTick)),
    );
    const anchorRatio = tickToSqrtRatio(anchorTick);
    if (
      run.current.sqrtRatio === anchorRatio ||
      increasing !== run.current.sqrtRatio < anchorRatio
    ) {
      return false;
    }
    const limit = nearer(increasing, anchorRatio, run.params.sqrtRatioLimit);
    this.call(run, { kind: 'toward' }, limit);
    return (
      run.remaining === 0n ||
      limit === run.params.sqrtRatioLimit ||
      run.current.sqrtRatio !== limit
    );
  }

  private away(run: SegmentRun, anchorX16: bigint): void {
    const { increasing } = run;
    const config = this.model.config;
    const a = increasing ? anchorX16 : -anchorX16;
    const grid = new Grid(a, this.tickSpacing, config);
    const p = increasing
      ? BigInt(run.current.tick)
      : -BigInt(run.current.tick) - 1n;
    let k = grid.firstSegment(p);
    let lo = k === 1 ? a : grid.boundary(k - 1);
    for (;;) {
      const hi = grid.boundary(k);
      const sur = surcharge(
        config,
        this.poolFee,
        lo + hi - 2n * a,
        this.tickSpacing,
      );
      const rateLimit = this.rateLimit(
        run,
        hi,
        sur === config.maxFee - this.poolFee,
      );
      if (rateLimit === null) {
        lo = hi;
        k += 1;
        continue;
      }
      this.awayCall(run, rateLimit, { kind: 'charged', k, surcharge: sur });
      if (
        run.remaining === 0n ||
        run.current.sqrtRatio === run.params.sqrtRatioLimit
      )
        return;
    }
  }

  // The limit at the segment's rate boundary; `null` if the price is already past it.
  private rateLimit(
    run: SegmentRun,
    hi: bigint,
    capped: boolean,
  ): bigint | null {
    const userLimit = run.params.sqrtRatioLimit;
    const hiTick = hi >> 16n;
    if (capped || hiTick > BigInt(MAX_TICK)) return userLimit;
    const { increasing } = run;
    const boundary = tickToSqrtRatio(Number(increasing ? hiTick : -hiTick));
    if (
      increasing
        ? boundary <= run.current.sqrtRatio
        : boundary >= run.current.sqrtRatio
    )
      return null;
    return nearer(increasing, boundary, userLimit);
  }

  private nextEvent(run: SegmentRun): { event: TickEvent; ratio: bigint } {
    const { increasing, search } = run;
    let event = search.search(run.current.tick, increasing);
    run.tickEventSearches += 1;
    let ratio = tickToSqrtRatio(event.tick);
    if (ratio === run.current.sqrtRatio) {
      event = search.search(
        increasing ? event.tick : event.tick - 1,
        increasing,
      );
      run.tickEventSearches += 1;
      ratio = tickToSqrtRatio(event.tick);
    }
    return { event, ratio };
  }

  // One away call: cut short of the next initialized tick, or a bridge onto it.
  private awayCall(
    run: SegmentRun,
    rateLimit: bigint,
    charged: MevCaptureV21CallKind,
  ): void {
    const { increasing } = run;
    const { event, ratio } = this.nextEvent(run);
    if (event.index === null) {
      this.call(run, charged, nearer(increasing, ratio, rateLimit));
      return;
    }
    const cut = increasing ? predSqrtRatio(ratio) : succSqrtRatio(ratio);
    if (cut === run.current.sqrtRatio) {
      this.call(
        run,
        { kind: 'bridge' },
        nearer(increasing, ratio, run.params.sqrtRatioLimit),
      );
    } else {
      this.call(run, charged, nearer(increasing, cut, rateLimit));
    }
  }

  // The surcharge on a charged call's calculated token.
  private callSurcharge(
    run: SegmentRun,
    kind: MevCaptureV21CallKind,
    calculated: bigint,
  ): bigint {
    if (kind.kind !== 'charged' || kind.surcharge === 0n) return 0n;
    if (!run.exactOut)
      return computeFee(
        calculated < 0n ? -calculated : calculated,
        kind.surcharge,
      );
    const inputNet = calculated - computeFee(calculated, this.poolFee);
    return amountBeforeFee(inputNet, kind.surcharge) - inputNet;
  }

  // Runs one Core call and, for a charged call, the surcharge on its calculated token.
  private call(
    run: SegmentRun,
    kind: MevCaptureV21CallKind,
    limit: bigint,
  ): void {
    const { isToken1 } = run.params;
    const before = run.current;
    const r = coreSwap(run.search, before, {
      fee: this.poolFee,
      isToken1,
      amount: run.remaining,
      limit,
    });
    const fee = this.callSurcharge(run, kind, isToken1 ? r.delta0 : r.delta1);
    const specified = isToken1 ? r.delta1 : r.delta0;
    run.calls.push({
      kind,
      sqrtRatioLimit: limit,
      amount: run.remaining,
      delta0: r.delta0,
      delta1: r.delta1,
      surcharge0: isToken1 ? fee : 0n,
      surcharge1: isToken1 ? 0n : fee,
      feesPaid: r.feesPaid,
      stateBefore: before,
      stateAfter: r.state,
      steps: r.steps,
      initializedTicksCrossed: r.crossed,
    });
    const progressed = !coreEquals(r.state, before) || specified !== 0n;
    run.remaining = checkedI128(run.remaining - specified);
    run.current = r.state;
    if (
      !progressed &&
      run.remaining !== 0n &&
      run.current.sqrtRatio !== run.params.sqrtRatioLimit
    ) {
      throw new MevCaptureV21QuoteError(
        'NoProgress',
        'a Core call moved neither the price nor the amount',
      );
    }
  }

  private summarize(
    run: SegmentRun,
    anchorX16: bigint,
  ): MevCaptureV21SegmentSwap {
    const totals = {
      delta0: 0n,
      delta1: 0n,
      surcharge0: 0n,
      surcharge1: 0n,
      feesPaid: 0n,
    };
    const resources: MevCaptureV21Resources = {
      coreCalls: run.calls.length,
      coreSteps: 0,
      initializedTicksCrossed: 0,
      bridges: 0,
      tickEventSearches: run.tickEventSearches,
      accumulateAsFees: 0,
      anchorUpdates: 0,
      stateWrites: 0,
    };
    for (const c of run.calls) {
      totals.delta0 = checkedI128(
        totals.delta0 + c.delta0 + checkedI128(c.surcharge0),
      );
      totals.delta1 = checkedI128(
        totals.delta1 + c.delta1 + checkedI128(c.surcharge1),
      );
      totals.surcharge0 += c.surcharge0;
      totals.surcharge1 += c.surcharge1;
      totals.feesPaid += c.feesPaid;
      resources.coreSteps += c.steps;
      resources.initializedTicksCrossed += c.initializedTicksCrossed;
      resources.bridges += c.kind.kind === 'bridge' ? 1 : 0;
      resources.accumulateAsFees += c.surcharge0 + c.surcharge1 !== 0n ? 1 : 0;
    }
    if (totals.feesPaid > MAX_U128) totals.feesPaid = MAX_U128;
    return {
      anchorX16,
      calls: run.calls,
      ...totals,
      coreStateAfter: run.current,
      resources,
    };
  }
}

function coreEquals(a: CoreState, b: CoreState): boolean {
  return (
    a.sqrtRatio === b.sqrtRatio &&
    a.tick === b.tick &&
    a.liquidity === b.liquidity
  );
}

function anchorEquals(a: MevCaptureV21Anchor, b: MevCaptureV21Anchor): boolean {
  return (Object.keys(a) as (keyof MevCaptureV21Anchor)[]).every(
    key => a[key] === b[key],
  );
}
