/* eslint-disable no-console */
// Exactness against the pool's own bytecode. testdata/vectors.json comes from the desk's generator
// (gen_vectors_anvil.py): every expected amount/error is what PropAMM.quoteDetailed returned on a local chain,
// or what a mined swap paid. Set MHOCDESK_VECTORS to use another file.
import * as fs from 'fs';
import * as path from 'path';
import {
  applySwap,
  constantsFor,
  type PoolConstants,
  type PropAMMSnapshot,
  quote,
  windowTime,
} from './mhoc-desk-math';

type Quote = {
  tokenIn: 'base' | 'quote' | 'other';
  amountIn: string;
  amountOut: string;
  error: string | null;
};
type Step = Partial<Quote> & {
  type: 'swap' | 'update';
  blockNumber: number;
  timestamp: number;
  stateWord?: string;
};
type Scenario = {
  name: string;
  snapshot: Record<string, string | number>;
  quoteBlockNumber: number;
  quoteTimestamp: number;
  nextBlockNumber: number;
  nextTimestamp: number;
  quotes: Quote[];
  nextQuotes: Quote[];
  sequence: Step[];
};
type Vectors = {
  meta: { contractSha256: string };
  pools: {
    baseDecimals: number;
    quoteDecimals: number;
    priceScale: string;
    kScale: number;
    scenarios: Scenario[];
  }[];
};

const file =
  process.env.MHOCDESK_VECTORS ||
  path.join(__dirname, 'testdata', 'vectors.json');
const vectors: Vectors = JSON.parse(fs.readFileSync(file, 'utf8'));

function snapshot(s: Record<string, string | number>): PropAMMSnapshot {
  const b = (k: string) => BigInt(s[k]);
  return {
    stateWord: b('stateWord'),
    floorBase: b('floorBase'),
    floorQuote: b('floorQuote'),
    maxNotional: b('maxNotional'),
    maxNotionalPerUpdate: b('maxNotionalPerUpdate'),
    maxNotionalPerWindow: b('maxNotionalPerWindow'),
    cardSeq: b('cardSeq'),
    cardFilled: b('cardFilled'),
    fillBlock: b('fillBlock'),
    blockFilled: b('blockFilled'),
    windowId: b('windowId'),
    windowFilled: b('windowFilled'),
    balanceBase: b('balanceBase'),
    balanceQuote: b('balanceQuote'),
    readTimestamp: b('readTimestamp'),
    blockNumber: Number(s.blockNumber),
  };
}

function checkQuotes(
  c: PoolConstants,
  s: PropAMMSnapshot,
  label: string,
  quotes: Quote[],
  blockNumber: number,
  timestamp: number,
): number {
  for (const q of quotes) {
    const r = quote(
      c,
      s,
      q.tokenIn,
      BigInt(q.amountIn),
      BigInt(blockNumber),
      BigInt(timestamp),
    );
    const l = `${label} ${q.tokenIn} ${q.amountIn}`;
    expect([l, r.ok ? null : r.error]).toEqual([l, q.error]);
    if (r.ok) expect([l, r.amountOut.toString()]).toEqual([l, q.amountOut]);
  }
  return quotes.length;
}

describe('MhocDesk math: contract-produced vectors', () => {
  it('reproduces every quoteDetailed result from the snapshot alone, in its block and in the next one', () => {
    let n = 0;
    for (const p of vectors.pools) {
      const c = constantsFor(
        p.baseDecimals,
        p.quoteDecimals,
        BigInt(p.priceScale),
        BigInt(p.kScale),
      );
      for (const sc of p.scenarios) {
        const s = snapshot(sc.snapshot);
        const label = `${p.baseDecimals}/${p.quoteDecimals} ${sc.name}`;
        n += checkQuotes(
          c,
          s,
          `${label} same block`,
          sc.quotes,
          sc.quoteBlockNumber,
          sc.quoteTimestamp,
        );
        n += checkQuotes(
          c,
          s,
          `${label} next block`,
          sc.nextQuotes,
          sc.nextBlockNumber,
          sc.nextTimestamp,
        );
      }
    }
    console.log(
      `${n} contract quotes reproduced exactly (contract sha256 ${vectors.meta.contractSha256})`,
    );
  });

  it('predicts every later on-chain fill or revert, applying each fill and each price update to the state', () => {
    let filled = 0;
    let updates = 0;
    for (const p of vectors.pools) {
      const c = constantsFor(
        p.baseDecimals,
        p.quoteDecimals,
        BigInt(p.priceScale),
        BigInt(p.kScale),
      );
      for (const sc of p.scenarios) {
        let s = snapshot(sc.snapshot);
        sc.sequence.forEach((st, i) => {
          if (st.type === 'update') {
            s = { ...s, stateWord: BigInt(st.stateWord!) };
            updates++;
            return;
          }
          const r = quote(
            c,
            s,
            st.tokenIn!,
            BigInt(st.amountIn!),
            BigInt(st.blockNumber),
            BigInt(st.timestamp),
          );
          const label = `${p.baseDecimals}/${p.quoteDecimals} ${sc.name} step ${i}`;
          expect([label, r.ok ? null : r.error]).toEqual([label, st.error]);
          if (!r.ok) return;
          expect([label, r.amountOut.toString()]).toEqual([
            label,
            st.amountOut,
          ]);
          s = applySwap(
            s,
            st.tokenIn as 'base' | 'quote',
            BigInt(st.amountIn!),
            r,
          );
          filled++;
        });
      }
    }
    console.log(
      `${filled} on-chain fills predicted exactly (${updates} price updates replayed)`,
    );
  });

  // test/ReadmeExample.t.sol of the contract: WETH/USDC with PRICE_SCALE 1e8 and K_SCALE 4, p = 3000, 1 bp
  // half-spreads, k = 0.1 bp per $10k on both sides (field 250); valid until timestamp 1000 and block 20
  const c = constantsFor(18, 6, 10n ** 8n, 4n);
  const card = (kBid: bigint, kAsk: bigint) =>
    (20n << 216n) |
    ((3000n * 10n ** 6n * 10n ** 8n) << 152n) |
    (100n << 136n) |
    (100n << 120n) |
    (kBid << 104n) |
    (kAsk << 88n) |
    (500000n << 64n) |
    (1n << 32n) |
    1000n;
  const readme: PropAMMSnapshot = {
    stateWord: card(250n, 250n),
    floorBase: 0n,
    floorQuote: 0n,
    maxNotional: 1n << 40n,
    maxNotionalPerUpdate: 1n << 40n,
    maxNotionalPerWindow: (1n << 32n) - 1n,
    cardSeq: 0n,
    cardFilled: 0n,
    fillBlock: 0n,
    blockFilled: 0n,
    windowId: 0n,
    windowFilled: 0n,
    balanceBase: 1n << 200n,
    balanceQuote: 1n << 200n,
    readTimestamp: 999n,
    blockNumber: 9,
  };
  const out = (
    s: PropAMMSnapshot,
    tokenIn: 'base' | 'quote',
    amountIn: bigint,
    block = 10n,
    now = 999n,
  ) => {
    const r = quote(c, s, tokenIn, amountIn, block, now);
    return r.ok ? r.amountOut : r.error;
  };

  it('matches the contract README worked example (first swap on a fresh card)', () => {
    expect(out(readme, 'base', 10n * 10n ** 18n)).toEqual(29_996_100_000n);
    expect(out(readme, 'quote', 100_000n * 10n ** 6n)).toEqual(
      33_326_667_999_733_386_656n,
    );
  });

  it('counts the per-minute budget at the earliest time the swap can land, not the wall clock', () => {
    // read at 999 (minute 16) with 24,000 of a 25,000 USDC minute budget used; the card lives until 2000
    const s: PropAMMSnapshot = {
      ...readme,
      stateWord: card(250n, 250n) - 1000n + 2000n,
      maxNotionalPerWindow: 25_000n,
      windowId: 16n,
      windowFilled: 24_000n * 10n ** 6n,
    };
    const one = 10n ** 18n; // about 3,000 USDC
    // the wall clock (1020, minute 17) alone frees the budget: the pool, in a block at 1000, reverts
    expect(quote(c, s, 'base', one, 10n, 1020n).ok).toBe(true);
    expect(windowTime(s, 1020n)).toEqual(1000n);
    expect(windowTime(s, 999n)).toEqual(999n);
    const r = quote(c, s, 'base', one, 10n, 1020n, windowTime(s, 1020n));
    expect(r.ok ? 'ok' : r.error).toEqual('ExceedsWindowCap');
    // read in the last second of a minute: the next block is in the next minute and the budget is free
    const late = { ...s, readTimestamp: 1019n };
    expect(windowTime(late, 1020n)).toEqual(1020n);
    expect(quote(c, late, 'base', one, 10n, 1020n, 1020n).ok).toBe(true);
  });

  it('prices a sell with kBid and a buy with kAsk, each times K_SCALE', () => {
    const s = (kBid: bigint, kAsk: bigint) => ({
      ...readme,
      stateWord: card(kBid, kAsk),
    });
    expect(out(s(250n, 9999n), 'base', 10n * 10n ** 18n)).toEqual(
      29_996_100_000n,
    );
    expect(out(s(9999n, 250n), 'quote', 100_000n * 10n ** 6n)).toEqual(
      33_326_667_999_733_386_656n,
    );
    const c1 = constantsFor(18, 6, 10n ** 8n, 1n);
    const r4 = quote(c, s(250n, 250n), 'base', 10n ** 19n, 10n, 999n);
    const r1 = quote(c1, s(1000n, 1000n), 'base', 10n ** 19n, 10n, 999n);
    expect(r4.ok && r1.ok && r4.amountOut === r1.amountOut).toEqual(true);
  });

  it('needs both expiries: block.timestamp <= validUntil and block.number <= validUntilBlock', () => {
    const a = 10n ** 18n;
    expect(typeof out(readme, 'base', a, 20n, 1000n)).toEqual('bigint');
    expect(out(readme, 'base', a, 21n, 999n)).toEqual('StalePrice');
    expect(out(readme, 'base', a, 20n, 1001n)).toEqual('StalePrice');
    expect(out(readme, 'base', a, (1n << 32n) + 20n, 999n)).toEqual(
      'StalePrice',
    );
  });

  it('never pays more for a split order than for one swap (slippage on the cumulative fill)', () => {
    for (const sameBlock of [true, false]) {
      const one = quote(c, readme, 'quote', 100_000n * 10n ** 6n, 10n, 999n);
      let s = readme;
      let total = 0n;
      for (let i = 0; i < 10; i++) {
        const block = sameBlock ? 10n : BigInt(10 + i);
        const r = quote(c, s, 'quote', 10_000n * 10n ** 6n, block, 999n);
        if (!r.ok) throw new Error(r.error);
        total += r.amountOut;
        s = applySwap(s, 'quote', 10_000n * 10n ** 6n, r);
      }
      const diff = (one.ok ? one.amountOut : 0n) - total;
      expect(diff >= 0n && diff < 100n).toEqual(true);
    }
  });

  it('treats a per-minute cap of 0 as no trading', () => {
    expect(
      out({ ...readme, maxNotionalPerWindow: 0n }, 'base', 10n ** 18n),
    ).toEqual('ExceedsWindowCap');
  });
});
