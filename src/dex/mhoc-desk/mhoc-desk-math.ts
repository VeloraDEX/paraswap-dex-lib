// Exact off-chain replica of PropAMM._compute: same order of checks, same integer arithmetic, same rounding. Pure
// bigint, so it can be tested on its own.
//
// F is the cumulative fill: max(Fs, Fb), Fs = notional already filled against this price card, Fb = notional
// already filled in this block (any card). k = kBid*K_SCALE on a sell and kAsk*K_SCALE on a buy,
// kw(x) = ceil(k*x*1e6/QU), WAD = 1e18:
//
//   sell BASE (a):  Q = ceil(a*p/D);  f = dBid*1e12 + kw(2F + Q);  out = floor(a*p*(WAD-f) / (D*WAD))
//   buy BASE  (b):  Q = b;  A = WAD + dAsk*1e12;  out = floor(b*D*WAD / (p*(A + kw(F + Q))))
//                   then, if kw(F) != 0, out = floor(out*A / (A + kw(F)))
//
// D = 10^baseDecimals * PRICE_SCALE, QU = 10^quoteDecimals. With F = 0 (a fresh card in a block without earlier
// fills) these are the single-swap formulas. A result is exactly what quote()/swap() return in the same state and
// block, or the custom error swap() reverts with.

import { type Card, decodeCard, isLive } from './mhoc-desk-card';

export { decodeCard };
export type { Card };

export const WAD = 10n ** 18n;
const SPREAD_TO_WAD = 10n ** 12n;
const K_TO_WAD = 10n ** 6n;
const MAX_AMOUNT_IN = 1n << 128n;
const U256 = (1n << 256n) - 1n;
const U32 = 1n << 32n;
export const WINDOW = 60n;

export type PropAMMError =
  | 'PoolPaused'
  | 'StalePrice'
  | 'ZeroAmount'
  | 'ExceedsMaxSize'
  | 'UnknownToken'
  | 'ExceedsUpdateCap'
  | 'ExceedsWindowCap'
  | 'NoFill'
  | 'BelowFloor'
  | 'Overflow';

// counters(): each counter is reset lazily by its own tag, so it is evaluated for the block of the swap:
//   Fs = cardSeq == seq ? cardFilled : 0
//   Fb = fillBlock == block.number mod 2^32 && windowId == block.timestamp / 60 ? blockFilled : 0
//   minute fill = windowId == block.timestamp / 60 ? windowFilled : 0
export type Counters = {
  cardSeq: bigint;
  cardFilled: bigint;
  fillBlock: bigint;
  blockFilled: bigint;
  windowId: bigint;
  windowFilled: bigint;
};

// Everything _compute reads, as of one block (read through the pool's public views, pinned to that block).
export type PropAMMSnapshot = Counters & {
  stateWord: bigint; // stateWord(): the price card (layout in mhoc-desk-card.ts)
  floorBase: bigint; // floorBase(), BASE raw
  floorQuote: bigint; // floorQuote(), QUOTE raw
  maxNotional: bigint; // maxNotional(), whole QUOTE tokens per swap
  maxNotionalPerUpdate: bigint; // C, whole QUOTE tokens per price card and per block
  maxNotionalPerWindow: bigint; // W, whole QUOTE tokens per calendar minute; 0 = no trading
  balanceBase: bigint; // BASE.balanceOf(pool)
  balanceQuote: bigint; // QUOTE.balanceOf(pool)
  readTimestamp: bigint; // block.timestamp of the block the snapshot was read at
  blockNumber: number;
};

export type PoolConstants = {
  D: bigint; // 10^baseDecimals * PRICE_SCALE
  quoteUnit: bigint; // 10^quoteDecimals
  kScale: bigint; // K_SCALE: the unit of the card's kBid and kAsk fields
};

export function constantsFor(
  baseDecimals: number,
  quoteDecimals: number,
  priceScale: bigint,
  kScale: bigint,
): PoolConstants {
  return {
    D: 10n ** BigInt(baseDecimals) * priceScale,
    quoteUnit: 10n ** BigInt(quoteDecimals),
    kScale,
  };
}

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

// _kWad: ceil(k*x*1e6 / QU), WAD fixed point, rounded up
const kWad = (k: bigint, x: bigint, qu: bigint) =>
  ceilDiv(k * x * K_TO_WAD, qu);

// The counters a fill of q in block (blockNumber, now) writes, as _compute's (budget, window) result.
export function afterFill(
  c: Counters,
  seq: bigint,
  q: bigint,
  blockNumber: bigint,
  now: bigint,
): Counters {
  const id = now / WINDOW;
  const sameMinute = c.windowId === id;
  return {
    cardSeq: seq,
    cardFilled: (c.cardSeq === seq ? c.cardFilled : 0n) + q,
    fillBlock: blockNumber % U32,
    blockFilled:
      (sameMinute && c.fillBlock === blockNumber % U32 ? c.blockFilled : 0n) +
      q,
    windowId: id,
    windowFilled: (sameMinute ? c.windowFilled : 0n) + q,
  };
}

// The pricing step of _compute, given the swap's notional q and the cumulative fill F: the size slippage on F with
// the side's own coefficient (kBid*K_SCALE on a sell, kAsk*K_SCALE on a buy), the two half-spreads and every
// rounding. NoFill for f >= 1 on a sell and for p = 0 on a buy; the caller rejects a zero output.
export function fillAmount(
  c: PoolConstants,
  card: Card,
  tokenIn: 'base' | 'quote',
  amountIn: bigint,
  q: bigint,
  F: bigint,
): bigint | PropAMMError {
  const p = card.price;
  if (tokenIn === 'base') {
    const k = card.kBid * c.kScale;
    const f = card.dBid * SPREAD_TO_WAD + kWad(k, 2n * F + q, c.quoteUnit);
    if (f >= WAD) return 'NoFill';
    const t = amountIn * p * (WAD - f);
    if (t > U256) return 'Overflow';
    return t / (c.D * WAD);
  }
  if (p === 0n) return 'NoFill';
  const k = card.kAsk * c.kScale;
  const a = WAD + card.dAsk * SPREAD_TO_WAD;
  const n = amountIn * c.D * WAD;
  const den = p * (a + kWad(k, F + q, c.quoteUnit));
  if (n > U256 || den > U256) return 'Overflow';
  const out = n / den;
  const kf = kWad(k, F, c.quoteUnit);
  return kf !== 0n ? (out * a) / (a + kf) : out;
}

// windowTime is the block.timestamp to use for the per-minute budget when the swap's time is a guess (the wall
// clock): the earliest time the swap can land, the snapshot's own block.timestamp + 1, capped by now. A wall clock
// that has crossed a minute the chain may not have reached must not free that minute's budget, or sizes would be
// quoted that revert with ExceedsWindowCap. Counting the snapshot's minute when the swap lands in a later one only
// makes the quote stricter than the pool.
export function windowTime(s: PropAMMSnapshot, now: bigint): bigint {
  const earliest = s.readTimestamp + 1n;
  return now < earliest ? now : earliest;
}

export type QuoteResult =
  | { ok: true; amountOut: bigint; notional: bigint; counters: Counters }
  | { ok: false; error: PropAMMError };

// tokenIn: 'base' (taker sells BASE), 'quote' (taker pays QUOTE) or 'other'; the swap runs in block
// (blockNumber, now). windowNow is the block.timestamp used for the per-minute budget (default: now); see
// windowTime() for pricing on a wall clock.
export function quote(
  c: PoolConstants,
  s: PropAMMSnapshot,
  tokenIn: 'base' | 'quote' | 'other',
  amountIn: bigint,
  blockNumber: bigint,
  now: bigint,
  windowNow: bigint = now,
): QuoteResult {
  const fail = (error: PropAMMError): QuoteResult => ({ ok: false, error });
  const card = decodeCard(s.stateWord);
  if (card.paused) return fail('PoolPaused');
  if (!isLive(card, blockNumber, now)) return fail('StalePrice');
  if (amountIn === 0n) return fail('ZeroAmount');
  if (amountIn > MAX_AMOUNT_IN) return fail('ExceedsMaxSize');

  const cap =
    (card.qMax < s.maxNotional ? card.qMax : s.maxNotional) * c.quoteUnit;
  const p = card.price;
  let q: bigint;
  if (tokenIn === 'base') q = ceilDiv(amountIn * p, c.D);
  else if (tokenIn === 'quote') q = amountIn;
  else return fail('UnknownToken');
  if (q > cap) return fail('ExceedsMaxSize');

  // per-card (Fs) and per-block (Fb) budgets against C, then the per-minute budget against W (0 = no trading)
  const limC = s.maxNotionalPerUpdate * c.quoteUnit;
  const fs = s.cardSeq === card.seq ? s.cardFilled : 0n;
  if (fs + q > limC) return fail('ExceedsUpdateCap');
  const id = windowNow / WINDOW;
  let wused = q;
  let bused = q;
  if (s.windowId === id) {
    wused += s.windowFilled;
    if (s.fillBlock === blockNumber % U32) bused += s.blockFilled;
  }
  if (bused > limC) return fail('ExceedsUpdateCap');
  if (wused > s.maxNotionalPerWindow * c.quoteUnit)
    return fail('ExceedsWindowCap');
  const F = bused - q > fs ? bused - q : fs;

  const out = fillAmount(c, card, tokenIn, amountIn, q, F);
  if (typeof out === 'string') return fail(out);
  if (out === 0n) return fail('NoFill');

  const balanceOut = tokenIn === 'base' ? s.balanceQuote : s.balanceBase;
  const floor = tokenIn === 'base' ? s.floorQuote : s.floorBase;
  if (balanceOut < out + floor) return fail('BelowFloor');
  return {
    ok: true,
    amountOut: out,
    notional: q,
    counters: afterFill(s, card.seq, q, blockNumber, windowNow),
  };
}

// The snapshot after a fill, as the contract leaves it: balances move and the three counters take the values the
// swap wrote (each restarted first if the swap's card, block or minute differs from its tag).
export function applySwap(
  s: PropAMMSnapshot,
  tokenIn: 'base' | 'quote',
  amountIn: bigint,
  r: { amountOut: bigint; counters: Counters },
): PropAMMSnapshot {
  const next = { ...s, ...r.counters };
  if (tokenIn === 'base') {
    next.balanceBase += amountIn;
    next.balanceQuote -= r.amountOut;
  } else {
    next.balanceQuote += amountIn;
    next.balanceBase -= r.amountOut;
  }
  return next;
}
