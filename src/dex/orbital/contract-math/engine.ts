// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Port of the quote path of src/libraries/OrbitalSwapEngine.sol (`quote` -> `_quote` and `quoteExactOutput` ->
// `_quoteExactOutput`, without the fee attribution, which never changes the endpoint). The search, solve and rounding
// order are copied step for step: the engine's endpoint can sit a few wei above the exact optimum
// (docs/SWAP_ENGINE_PROOF.md, Theorem 4), so only the same sequence of integer probes reproduces the on-chain output
// to the wei.
import { absDiff, div, max, sqrtDown, sqrtUp, sub, toInt256 } from './arith';
import {
  BISECTION_STEPS,
  MAX_TICK,
  MAX_WALK,
  NEWTON_STEPS,
  SQRT3_X36,
  X36,
} from './constants';
import { check } from './errors';
import { circle, locate, Side, type Circle, type Position } from './invariant';
import { planeCeil, type PoolState } from './state';
import { kNormAtTick, nextInitializedTick, type TickRecord } from './tick';

/** Line of candidate points (a, u, z) up to asset order, with the output reserve u free. */
type Line = {
  a: bigint;
  z: bigint;
  top: bigint;
  floor: bigint;
  fixedSum: bigint;
  fixedSquares: bigint;
  /** 3 * (a - z)^2. */
  twiceK: bigint;
};

/** Boundary prefix of the initialized ticks, its two neighbouring ticks by index, its circle and its reserve-sum range. */
type Partition = {
  count: number;
  /** Top boundary tick; 0, the no-tick sentinel, when every tick is interior. */
  down: number;
  /** Next interior tick; the permanent seed guarantees one. */
  up: number;
  circle: Circle;
  lowerSum: bigint;
  upperSum: bigint;
};

/** Endpoint of a swap in normalized units. */
export type EngineResult = {
  /** New input reserve. */
  reserveIn: bigint;
  /** New output reserve. */
  reserveOut: bigint;
  /** Normalized output: old output reserve minus the new one. */
  amountOut: bigint;
  /** Geometry of the end partition. */
  rInt: bigint;
  kBound: bigint;
  sBound: bigint;
  topBoundary: number;
  boundaryTickCount: number;
  /** Ticks that changed status between the start and the end partition. */
  ticksCrossed: number;
};

/**
 * OrbitalSwapEngine.quote, endpoint only. `netInput` is the normalized input after the fee. The caller has validated
 * the asset pair; every reserve of `state` lies in [floor, totalRadius].
 */
export function solveExactInput(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  netInput: bigint,
): EngineResult {
  const line = outputLine(state, assetIn, assetOut, netInput);
  const start = startPartition(state);
  const [newReserveOut, end] = search(state, line, start);
  check(newReserveOut !== line.floor, 'Output exceeds reserves');
  return {
    reserveIn: line.a,
    reserveOut: newReserveOut,
    amountOut: line.top - newReserveOut,
    rInt: end.circle.rInt,
    kBound: end.circle.kBound,
    sBound: end.circle.sBound,
    topBoundary: end.down,
    boundaryTickCount: end.count,
    ticksCrossed: Math.abs(end.count - start.count),
  };
}

/**
 * OrbitalSwapEngine.quoteExactOutput, endpoint only: the output reserve falls by exactly `outputNorm`, the untouched
 * reserve stays, and the input reserve rises to the smallest certified value. The inverse line frees the input reserve
 * from its current value up to the total radius; the search is the exact-input one.
 */
export function solveExactOutput(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  outputNorm: bigint,
): EngineResult {
  const reserveOut = state.reserves[assetOut];
  check(outputNorm < reserveOut - state.floor, 'Output exceeds reserves');
  const line = makeLine(
    reserveOut - outputNorm,
    state.reserves[3 - assetIn - assetOut],
    state.totalRadius,
    state.reserves[assetIn],
  );
  const start = startPartition(state);
  const [newReserveIn, end] = search(state, line, start);
  return {
    reserveIn: newReserveIn,
    reserveOut: line.a,
    amountOut: outputNorm,
    rInt: end.circle.rInt,
    kBound: end.circle.kBound,
    sBound: end.circle.sBound,
    topBoundary: end.down,
    boundaryTickCount: end.count,
    ticksCrossed: Math.abs(end.count - start.count),
  };
}

/** _outputLine: the fixed-input line. */
function outputLine(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  netInput: bigint,
): Line {
  const xiOld = state.reserves[assetIn];
  check(netInput <= sub(state.totalRadius, xiOld), 'Input exceeds radius');
  // 3 - assetIn - assetOut is the untouched index.
  return makeLine(
    xiOld + netInput,
    state.reserves[3 - assetIn - assetOut],
    state.reserves[assetOut],
    state.floor,
  );
}

/** _line. */
function makeLine(a: bigint, z: bigint, top: bigint, floor: bigint): Line {
  return {
    a,
    z,
    top,
    floor,
    fixedSum: a + z,
    fixedSquares: a ** 2n + z ** 2n,
    twiceK: 3n * absDiff(a, z) ** 2n,
  };
}

/** The record of an initialized tick: `_plane` and `_offset` read its r, k and s. */
function record(state: PoolState, index: number): TickRecord {
  const tick = state.ticks[index];
  if (!tick) throw new Error(`Missing record of initialized tick ${index}`);
  return tick;
}

/**
 * _startPartition: the stored partition and its neighbouring ticks. A swap starts from the cached `state.up`, which every
 * commit sets to the bitmap's next initialized tick above the top boundary; the SDK derives that same value from the
 * bitmap, so the state read needs no extra field.
 */
function startPartition(state: PoolState): Partition {
  const up = nextInitializedTick(state.bitmap, state.topBoundary, false);
  const p = partition(
    state.boundaryTickCount,
    state.topBoundary,
    up,
    state.rInt,
    state.kBound,
    state.sBound,
  );
  p.lowerSum = lowerSum(state, p);
  p.upperSum = upperSum(p);
  return p;
}

/** _partition: builds a partition and caches its circle; the caller sets its reserve-sum range. */
function partition(
  count: number,
  down: number,
  up: number,
  rInt: bigint,
  kBound: bigint,
  sBound: bigint,
): Partition {
  return {
    count,
    down,
    up,
    circle: circle(rInt, kBound, sBound),
    lowerSum: 0n,
    upperSum: 0n,
  };
}

/** _upperSum: the smallest S at which `up` is a boundary tick, written in this partition. */
function upperSum(p: Partition): bigint {
  return planeCeil(p.circle.kBound, p.circle.rInt, kNormAtTick(p.up));
}

/** _lowerSum: the same threshold for `down`, written in the partition below. */
function lowerSum(state: PoolState, p: Partition): bigint {
  if (p.count === 0) return 0n;
  const { r, k } = record(state, p.down);
  return planeCeil(
    sub(p.circle.kBound, k),
    p.circle.rInt + r,
    kNormAtTick(p.down),
  );
}

/** _up: moves the next interior tick to the boundary. */
function up(state: PoolState, p: Partition): Partition {
  const tick = p.up;
  const { r, k, s } = record(state, tick);
  const next = nextInitializedTick(state.bitmap, tick, false);
  const c = p.circle;
  const q = partition(
    p.count + 1,
    tick,
    next,
    sub(c.rInt, r),
    c.kBound + k,
    c.sBound + s,
  );
  q.lowerSum = p.upperSum;
  q.upperSum = upperSum(q);
  return q;
}

/** _down: moves the top boundary tick back to the interior. */
function down(state: PoolState, p: Partition): Partition {
  const tick = p.down;
  const { r, k, s } = record(state, tick);
  const below = nextInitializedTick(state.bitmap, tick - 1, true);
  const c = p.circle;
  const q = partition(
    p.count - 1,
    below,
    tick,
    c.rInt + r,
    sub(c.kBound, k),
    sub(c.sBound, s),
  );
  q.lowerSum = lowerSum(state, q);
  q.upperSum = p.lowerSum;
  return q;
}

/** _canClimb: whether the next interior tick is not the permanent seed. */
function canClimb(p: Partition): boolean {
  return p.up !== MAX_TICK;
}

/** _search: smallest certified integer of the line, Up then Down then Solve. */
function search(
  state: PoolState,
  line: Line,
  p: Partition,
): [bigint, Partition] {
  let [lo, hi, meets] = piece(line, p);
  let top: Position | undefined;

  // 1. Up
  for (let step = 0; ; step++) {
    if (meets) {
      top = probe(line, p, hi);
      if (top.side !== Side.Outside) break;
      check(hi !== line.top, 'No output');
    }
    check(step !== MAX_WALK && canClimb(p), 'Seed limit');
    p = up(state, p);
    [lo, hi, meets] = piece(line, p);
  }

  // 2. Down
  let bottom = lo === hi ? top! : probe(line, p, lo);
  for (
    let step = 0;
    step < MAX_WALK && bottom.side !== Side.Outside && lo !== line.floor;
    step++
  ) {
    const above = p;
    const aboveLo = lo;
    p = down(state, p);
    [lo, hi] = piece(line, p);
    top = probe(line, p, hi);
    if (top.side === Side.Outside) return certified(bottom, aboveLo, above);
    bottom = lo === hi ? top : probe(line, p, lo);
  }

  // 3. Solve
  if (bottom.side === Side.Outside) {
    if (p.count === 0) return [solveSphere(line, p.circle.rInt), p];
    return [solveTorus(line, p, lo, hi, top!), p];
  }
  return certified(bottom, lo, p);
}

/** _certified: accepts a point only when it is certified on the physical branch. */
function certified(
  position: Position,
  u: bigint,
  p: Partition,
): [bigint, Partition] {
  check(position.side === Side.Inside, 'Off-branch endpoint');
  return [u, p];
}

/** _piece: integer candidates of the line inside partition `p`. */
function piece(line: Line, p: Partition): [bigint, bigint, boolean] {
  const lo =
    p.lowerSum > line.fixedSum + line.floor
      ? p.lowerSum - line.fixedSum
      : line.floor;
  if (p.upperSum <= line.fixedSum + lo) return [lo, lo, false];
  let hi = p.upperSum - 1n - line.fixedSum;
  if (hi > line.top) hi = line.top;
  return [lo, hi, lo <= hi];
}

/** _probe: classifies one point of the line in partition `p`. */
function probe(line: Line, p: Partition, u: bigint): Position {
  return locate(p.circle, line.fixedSum + u, line.fixedSquares + u ** 2n);
}

/** _solveSphere: closed form on the ideal sphere. */
function solveSphere(line: Line, radius: bigint): bigint {
  const fixedDistance = sub(radius, line.a) ** 2n + sub(radius, line.z) ** 2n;
  return sub(radius, sqrtDown(sub(radius ** 2n, fixedDistance)));
}

/** _solveTorus: smallest certified integer of (lo, hi] on one fixed torus. */
function solveTorus(
  line: Line,
  p: Partition,
  lo: bigint,
  hi: bigint,
  hiProbe: Position,
): bigint {
  // 1. Gap
  const gap = belowGap(line, p);
  if (gap !== null && gap >= lo && gap < hi) {
    hi = gap;
    hiProbe = probe(line, p, hi);
  }
  check(hiProbe.side === Side.Inside, 'Off-branch endpoint');

  // 2. Bracket
  let u = hi;
  let point = hiProbe;
  for (
    let step = 0;
    step < NEWTON_STEPS + BISECTION_STEPS && hi - lo > 1n;
    step++
  ) {
    let next = lo + (hi - lo) / 2n;
    if (step < NEWTON_STEPS) {
      const proposal = newtonProposal(line, u, point);
      if (proposal > lo && proposal < hi) next = proposal;
    }
    point = probe(line, p, next);
    check(point.side !== Side.Inner, 'Off-branch endpoint');
    if (point.side === Side.Outside) lo = next;
    else hi = next;
    u = next;
  }
  return hi;
}

/** _newtonProposal: next Newton point from the branch point `u`; 0 when the slope is unusable. */
function newtonProposal(line: Line, u: bigint, point: Position): bigint {
  // Solidity evaluates `2 * radial * (3u - S) / (3 * wLo)` left to right and truncates toward zero, like bigint.
  const gradient =
    -toInt256((2n * point.axial * X36) / SQRT3_X36) +
    div(
      2n *
        toInt256(point.radial) *
        (3n * toInt256(u) - toInt256(line.fixedSum + u)),
      toInt256(3n * point.wLo),
    );
  if (gradient >= 0n) return 0n;
  const slope = -gradient;
  if (point.residual > 0n) return u + (point.residual + slope - 1n) / slope;
  const back = max(-point.residual / slope, 1n);
  return back < u ? u - back : 0n;
}

/** _belowGap: last integer of the line below the gap ||w|| < sBound, or null when the line misses the gap. */
function belowGap(line: Line, p: Partition): bigint | null {
  const sixSquares = 6n * p.circle.sBound ** 2n;
  if (sixSquares <= line.twiceK) return null;
  const root = sqrtUp(sixSquares - line.twiceK);
  if (line.fixedSum < root) return null;
  return (line.fixedSum - root) / 2n;
}
