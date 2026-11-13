// Emulation of Core's concentrated-liquidity swap, as called by the
// MEVCapture v2.1 extension. The extension splits a swap into several
// `Core.swap` calls and cuts them at Core's own tick events (bitmap word
// boundaries and initialized ticks), so this mirrors Core's integer math and
// tick bitmap search exactly rather than reusing the approximations of the
// plain concentrated pool quote.
import { MAX_U128, MAX_U256 } from './constants';
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from './tick';

const MIN_I128 = -(1n << 127n);
const MAX_I128 = (1n << 127n) - 1n;
const Q64 = 1n << 64n;
const Q128 = 1n << 128n;
const MANTISSA_BITS = 94n;
const MANTISSA_MASK = (1n << MANTISSA_BITS) - 1n;
const TICK_BITMAP_STORAGE_OFFSET = 89_421_695;

export type MevCaptureV21QuoteErrorCode =
  | 'InvalidSqrtRatioLimit'
  | 'SqrtRatioLimitWrongDirection'
  | 'InvalidTick'
  | 'AmountOverflow'
  | 'LiquidityOverflow'
  | 'AmountDeltaOverflow'
  | 'NoProgress'
  | 'TickRangeExceeded';

export class MevCaptureV21QuoteError extends Error {
  public constructor(
    public readonly code: MevCaptureV21QuoteErrorCode,
    message: string = code,
  ) {
    super(`MEVCaptureV21: ${message}`);
    this.name = 'MevCaptureV21QuoteError';
  }
}

const fail = (code: MevCaptureV21QuoteErrorCode, message?: string): never => {
  throw new MevCaptureV21QuoteError(code, message);
};

/** Core pool state; `sqrtRatio` is the 64.128 fixed-point ratio. */
export interface CoreState {
  sqrtRatio: bigint;
  /** Core's stored tick: one below the price's tick after a decreasing swap stopped on a tick. */
  tick: number;
  liquidity: bigint;
}

/** An initialized tick and its signed net liquidity delta (crossing upward). */
export interface InitializedTick {
  readonly number: number;
  readonly liquidityDelta: bigint;
}

export function checkedI128(x: bigint): bigint {
  return x < MIN_I128 || x > MAX_I128 ? fail('AmountOverflow') : x;
}

function checkedU128(x: bigint, code: MevCaptureV21QuoteErrorCode): bigint {
  return x < 0n || x > MAX_U128 ? fail(code) : x;
}

function ceilDiv(n: bigint, d: bigint): bigint {
  return n / d + (n % d === 0n ? 0n : 1n);
}

function mulDiv(a: bigint, b: bigint, d: bigint, roundUp: boolean): bigint {
  const r = roundUp ? ceilDiv(a * b, d) : (a * b) / d;
  return r > MAX_U256 ? fail('AmountDeltaOverflow') : r;
}

/** Core's `computeFee` with a 0.64 fee (rounds up). */
export function computeFee(amount: bigint, fee: bigint): bigint {
  return ceilDiv(amount * fee, Q64);
}

/** Core's `amountBeforeFee` with a 0.64 fee (rounds up, reverts above uint128). */
export function amountBeforeFee(afterFee: bigint, fee: bigint): bigint {
  return checkedU128(ceilDiv(afterFee << 64n, Q64 - fee), 'AmountOverflow');
}

function region(fixed: bigint): bigint {
  if (fixed >= 1n << 160n) return 3n;
  if (fixed >= 1n << 128n) return 2n;
  return fixed >= 1n << 96n ? 1n : 0n;
}

function fromRaw(r: bigint, mantissa: bigint): bigint {
  return mantissa << (2n + 32n * r);
}

/** Fixed-point value of a raw `SqrtRatio` (`region << 94 | mantissa`). */
export function sqrtRatioFromRaw(raw: bigint): bigint {
  return fromRaw(raw >> MANTISSA_BITS, raw & MANTISSA_MASK);
}

/** Raw `SqrtRatio` of a representable fixed-point ratio. */
export function sqrtRatioToRaw(fixed: bigint): bigint {
  const r = region(fixed);
  return (r << MANTISSA_BITS) | (fixed >> (2n + 32n * r));
}

/** The largest valid sqrt ratio strictly below `x`. */
export function predSqrtRatio(x: bigint): bigint {
  const r = region(x);
  const mantissa = x >> (2n + 32n * r);
  if (r !== 0n && mantissa === 1n << 62n) return fromRaw(r - 1n, MANTISSA_MASK);
  return fromRaw(r, mantissa - 1n);
}

/** The smallest valid sqrt ratio strictly above `x`. */
export function succSqrtRatio(x: bigint): bigint {
  const r = region(x);
  const mantissa = x >> (2n + 32n * r);
  if (r !== 3n && mantissa === MANTISSA_MASK) return fromRaw(r + 1n, 1n << 62n);
  return fromRaw(r, mantissa + 1n);
}

function adjustPrecision(fixed: bigint): bigint {
  const shift = 2n + 32n * region(fixed);
  return (fixed >> shift) << shift;
}

export function isValidSqrtRatio(sqrtRatio: bigint): boolean {
  return (
    sqrtRatio >= MIN_SQRT_RATIO &&
    sqrtRatio <= MAX_SQRT_RATIO &&
    adjustPrecision(sqrtRatio) === sqrtRatio
  );
}

/** Rounds a computed ratio to stored precision; the region is chosen after rounding. */
function roundSqrtRatio(ratio: bigint, roundUp: boolean): bigint {
  for (let r = 0n; r < 4n; r++) {
    const shift = 2n + 32n * r;
    const rounded = roundUp ? ratio + (1n << shift) - 1n : ratio;
    if (rounded < 1n << (96n + 32n * r)) return (rounded >> shift) << shift;
  }
  return MAX_U256;
}

export function tickToSqrtRatio(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    return fail('InvalidTick', `invalid tick ${tick}`);
  }
  return toSqrtRatio(tick);
}

/** The greatest tick whose sqrt ratio is at most `sqrtRatio`, clamped to the tick bounds. */
export function sqrtRatioToTick(sqrtRatio: bigint): number {
  let lo = MIN_TICK;
  let hi = MAX_TICK;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (toSqrtRatio(mid) <= sqrtRatio) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function amount0Delta(a: bigint, b: bigint, liquidity: bigint, up: boolean) {
  const [lower, upper] = a < b ? [a, b] : [b, a];
  if (liquidity === 0n || lower === upper) return 0n;
  const r0 = mulDiv(upper - lower, liquidity << 128n, upper, up);
  const r = up ? ceilDiv(r0, lower) : r0 / lower;
  return checkedU128(r, 'AmountDeltaOverflow');
}

function amount1Delta(a: bigint, b: bigint, liquidity: bigint, up: boolean) {
  const [lower, upper] = a < b ? [a, b] : [b, a];
  if (liquidity === 0n || lower === upper) return 0n;
  return checkedU128(
    mulDiv(liquidity, upper - lower, Q128, up),
    'AmountDeltaOverflow',
  );
}

// `null` where Core's price math fails (the step then goes to the limit)
function nextFromAmount0(s: bigint, liquidity: bigint, amount: bigint) {
  const numerator1 = liquidity << 128n;
  if (amount < 0n) {
    const product = -amount * s;
    if (product > MAX_U256 || product >= numerator1) return null;
    const r = ceilDiv(numerator1 * s, numerator1 - product);
    return r > MAX_U256 ? null : r;
  }
  return ceilDiv(numerator1, numerator1 / s + amount);
}

function nextFromAmount1(s: bigint, liquidity: bigint, amount: bigint) {
  if (amount < 0n) {
    const next = s - ceilDiv(-amount << 128n, liquidity);
    return next < 0n ? null : next;
  }
  const next = s + (amount << 128n) / liquidity;
  return next > MAX_U256 ? null : next;
}

function nextFromAmount(
  s: bigint,
  liquidity: bigint,
  amount: bigint,
  isToken1: boolean,
) {
  if (amount === 0n) return s;
  // rounded toward the starting price for input, away from it for output
  if (isToken1) {
    const next = nextFromAmount1(s, liquidity, amount);
    return next === null ? null : roundSqrtRatio(next, false);
  }
  const next = nextFromAmount0(s, liquidity, amount);
  return next === null ? null : roundSqrtRatio(next, true);
}

interface Step {
  consumed: bigint;
  calculated: bigint;
  next: bigint;
  fee: bigint;
}

interface StepInput {
  sqrtRatio: bigint;
  liquidity: bigint;
  limit: bigint;
  amount: bigint;
  isToken1: boolean;
  fee: bigint;
}

function stepToLimit({
  sqrtRatio,
  liquidity,
  limit,
  amount,
  isToken1,
  fee,
}: StepInput): Step {
  const exactOut = amount < 0n;
  const [specifiedDelta, calculatedDelta] = isToken1
    ? [amount1Delta, amount0Delta]
    : [amount0Delta, amount1Delta];
  const specified = specifiedDelta(limit, sqrtRatio, liquidity, !exactOut);
  const calculated = calculatedDelta(limit, sqrtRatio, liquidity, exactOut);
  if (exactOut) {
    const before = amountBeforeFee(calculated, fee);
    return {
      consumed: -checkedI128(specified),
      calculated: before,
      fee: before - calculated,
      next: limit,
    };
  }
  const before = amountBeforeFee(specified, fee);
  return {
    consumed: checkedI128(before),
    calculated,
    fee: before - specified,
    next: limit,
  };
}

function stepWithin(input: StepInput, next: bigint, inputFee: bigint): Step {
  const { sqrtRatio, liquidity, amount, isToken1, fee } = input;
  if (next === sqrtRatio) {
    return {
      consumed: amount,
      calculated: 0n,
      fee: amount < 0n ? -amount : amount,
      next,
    };
  }
  const exactOut = amount < 0n;
  const excluding = (isToken1 ? amount0Delta : amount1Delta)(
    next,
    sqrtRatio,
    liquidity,
    exactOut,
  );
  if (!exactOut)
    return { consumed: amount, calculated: excluding, fee: inputFee, next };
  const including = amountBeforeFee(excluding, fee);
  return {
    consumed: amount,
    calculated: including,
    fee: including - excluding,
    next,
  };
}

function computeStep(input: StepInput): Step {
  const { sqrtRatio, liquidity, limit, amount, isToken1, fee } = input;
  if (amount === 0n || sqrtRatio === limit) {
    return { consumed: 0n, calculated: 0n, fee: 0n, next: sqrtRatio };
  }
  const increasing = amount < 0n !== isToken1;
  if (limit < sqrtRatio === increasing) {
    return fail(
      'SqrtRatioLimitWrongDirection',
      'compute step: wrong direction',
    );
  }
  if (liquidity === 0n)
    return { consumed: 0n, calculated: 0n, fee: 0n, next: limit };
  const inputFee = amount < 0n ? 0n : computeFee(amount, fee);
  const next = nextFromAmount(
    sqrtRatio,
    liquidity,
    amount - inputFee,
    isToken1,
  );
  if (next !== null && next <= limit === increasing) {
    return stepWithin(input, next, inputFee);
  }
  return stepToLimit(input);
}

function lowerBound<T>(
  items: readonly T[],
  before: (item: T) => boolean,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (before(items[mid])) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A tick event found by Core's bitmap search; `index` is the initialized tick, if any. */
export interface TickEvent {
  tick: number;
  index: number | null;
}

/**
 * Core's `findNextInitializedTick` / `findPrevInitializedTick` over a sorted
 * list of initialized ticks, with its bitmap words and `skipAhead`.
 *
 * The list only needs to be complete within `bounds`: a search whose result
 * lies outside them could have missed an initialized tick that is not known,
 * so it fails with `TickRangeExceeded` instead of guessing.
 */
export class CoreTickSearch {
  public constructor(
    public readonly ticks: readonly InitializedTick[],
    public readonly spacing: number,
    public readonly skipAhead: number,
    public readonly bounds: readonly [number, number] = [MIN_TICK, MAX_TICK],
  ) {}

  // `tickToBitmapWordAndIndex` as one raw index (rounds toward negative infinity)
  private raw(tick: number): number {
    return Math.floor(tick / this.spacing) + TICK_BITMAP_STORAGE_OFFSET;
  }

  private tickOf(raw: number): number {
    return (raw - TICK_BITMAP_STORAGE_OFFSET) * this.spacing;
  }

  private known(event: TickEvent): TickEvent {
    if (event.tick < this.bounds[0] || event.tick > this.bounds[1]) {
      return fail(
        'TickRangeExceeded',
        `tick search reached ${event.tick} outside the known range [${this.bounds[0]}, ${this.bounds[1]}]`,
      );
    }
    return event;
  }

  public next(from: number): TickEvent {
    let next = from;
    for (let skip = this.skipAhead; ; skip--) {
      const raw = this.raw(next + this.spacing);
      const wordEnd = Math.floor(raw / 256) * 256 + 255;
      const i = lowerBound(this.ticks, t => this.raw(t.number) < raw);
      const t = this.ticks[i];
      if (t !== undefined && this.raw(t.number) <= wordEnd)
        return this.known({ tick: t.number, index: i });
      next = this.tickOf(wordEnd);
      if (next >= MAX_TICK) return this.known({ tick: MAX_TICK, index: null });
      if (skip === 0) return this.known({ tick: next, index: null });
    }
  }

  public prev(from: number): TickEvent {
    let prev = from;
    for (let skip = this.skipAhead; ; skip--) {
      const raw = this.raw(prev);
      const wordStart = Math.floor(raw / 256) * 256;
      const i = lowerBound(this.ticks, t => this.raw(t.number) <= raw);
      if (i > 0 && this.raw(this.ticks[i - 1].number) >= wordStart) {
        return this.known({ tick: this.ticks[i - 1].number, index: i - 1 });
      }
      prev = this.tickOf(wordStart);
      if (prev <= MIN_TICK) return this.known({ tick: MIN_TICK, index: null });
      if (skip === 0) return this.known({ tick: prev, index: null });
      prev -= 1;
    }
  }

  public search(from: number, increasing: boolean): TickEvent {
    return increasing ? this.next(from) : this.prev(from);
  }
}

export interface CoreSwapResult {
  delta0: bigint;
  delta1: bigint;
  feesPaid: bigint;
  state: CoreState;
  steps: number;
  crossed: number;
}

interface CoreSwapParams {
  fee: bigint;
  isToken1: boolean;
  amount: bigint;
  limit: bigint;
}

interface LoopState extends CoreState {
  remaining: bigint;
  calculated: bigint;
  feesPaid: bigint;
  steps: number;
  crossed: number;
}

/** `Core.swap` for a concentrated pool. */
export function coreSwap(
  search: CoreTickSearch,
  state: CoreState,
  params: CoreSwapParams,
): CoreSwapResult {
  const { amount, limit } = params;
  if (!isValidSqrtRatio(limit)) return fail('InvalidSqrtRatioLimit');
  if (amount === 0n || state.sqrtRatio === limit) {
    return {
      delta0: 0n,
      delta1: 0n,
      feesPaid: 0n,
      state,
      steps: 0,
      crossed: 0,
    };
  }
  const increasing = params.isToken1 !== amount < 0n;
  if (limit < state.sqrtRatio === increasing)
    return fail('SqrtRatioLimitWrongDirection');
  const s: LoopState = {
    ...state,
    remaining: amount,
    calculated: 0n,
    feesPaid: 0n,
    steps: 0,
    crossed: 0,
  };
  do {
    coreSwapStep(search, s, params, increasing);
  } while (s.remaining !== 0n && s.sqrtRatio !== limit);
  return coreSwapResult(s, params);
}

function coreSwapStep(
  search: CoreTickSearch,
  s: LoopState,
  p: CoreSwapParams,
  increasing: boolean,
) {
  const event = search.search(s.tick, increasing);
  const nextRatio = tickToSqrtRatio(event.tick);
  const limited = increasing === nextRatio < p.limit ? nextRatio : p.limit;
  const step = computeStep({
    sqrtRatio: s.sqrtRatio,
    liquidity: s.liquidity,
    limit: limited,
    amount: s.remaining,
    isToken1: p.isToken1,
    fee: p.fee,
  });
  s.remaining = checkedI128(s.remaining - step.consumed);
  s.calculated = checkedU128(s.calculated + step.calculated, 'AmountOverflow');
  s.feesPaid =
    s.feesPaid + step.fee > MAX_U128 ? MAX_U128 : s.feesPaid + step.fee;
  s.steps += 1;
  if (step.next === nextRatio) {
    crossTick(search, s, event, nextRatio, increasing);
  } else if (step.next !== s.sqrtRatio) {
    s.sqrtRatio = step.next;
    s.tick = sqrtRatioToTick(step.next);
  }
}

function crossTick(
  search: CoreTickSearch,
  s: LoopState,
  event: TickEvent,
  ratio: bigint,
  increasing: boolean,
) {
  s.sqrtRatio = ratio;
  s.tick = increasing ? event.tick : event.tick - 1;
  if (event.index === null) return;
  const delta = search.ticks[event.index].liquidityDelta;
  s.liquidity = checkedU128(
    s.liquidity + (increasing ? delta : -delta),
    'LiquidityOverflow',
  );
  s.crossed += 1;
}

function coreSwapResult(s: LoopState, p: CoreSwapParams): CoreSwapResult {
  const specified = checkedI128(p.amount - s.remaining);
  let calculated: bigint;
  if (p.amount < 0n) calculated = checkedI128(s.calculated);
  else calculated = s.calculated >= 1n << 127n ? MIN_I128 : -s.calculated;
  return {
    delta0: p.isToken1 ? calculated : specified,
    delta1: p.isToken1 ? specified : calculated,
    feesPaid: s.feesPaid,
    state: { sqrtRatio: s.sqrtRatio, tick: s.tick, liquidity: s.liquidity },
    steps: s.steps,
    crossed: s.crossed,
  };
}
