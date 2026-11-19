// The reads that make up one PropAMMSnapshot, and their decoding. Kept free of dex-lib imports (only ethers'
// Interface, which dex-lib already depends on) so the encoding can be tested on its own against a live chain.
import { Interface } from '@ethersproject/abi';
import PropAMMABI from '../../abi/mhoc-desk/PropAMM.json';
import RegistryABI from '../../abi/mhoc-desk/PropAMMRegistry.json';
import type { PropAMMSnapshot } from './mhoc-desk-math';

export const propAMMIface = new Interface(PropAMMABI);
export const registryIface = new Interface(RegistryABI);
export const erc20BalanceIface = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// The immutables that describe a pool, in the order they are read for a pool found through the registry.
export const POOL_IMMUTABLES = [
  'BASE',
  'QUOTE',
  'PRICE_SCALE',
  'K_SCALE',
] as const;
export const blockTimestampIface = new Interface([
  'function getCurrentBlockTimestamp() view returns (uint256)',
]);

// The pool views, in the order of the reads; the poller and the tests both use it. counters() returns six words
// (cardSeq, cardFilled, fillBlock, blockFilled, windowId, windowFilled), every other view one.
export const SNAPSHOT_VIEWS = [
  'stateWord',
  'floorBase',
  'floorQuote',
  'maxNotional',
  'maxNotionalPerUpdate',
  'maxNotionalPerWindow',
  'counters',
] as const;

export type SnapshotCall = { target: string; callData: string };

// pool views, then BASE.balanceOf(pool), QUOTE.balanceOf(pool), then multicall.getCurrentBlockTimestamp()
export function snapshotCalls(
  pool: string,
  base: string,
  quote: string,
  multicall: string,
): SnapshotCall[] {
  return [
    ...SNAPSHOT_VIEWS.map(m => ({
      target: pool,
      callData: propAMMIface.encodeFunctionData(m, []),
    })),
    {
      target: base,
      callData: erc20BalanceIface.encodeFunctionData('balanceOf', [pool]),
    },
    {
      target: quote,
      callData: erc20BalanceIface.encodeFunctionData('balanceOf', [pool]),
    },
    {
      target: multicall,
      callData: blockTimestampIface.encodeFunctionData(
        'getCurrentBlockTimestamp',
        [],
      ),
    },
  ];
}

// Every view returns static words only (uint256/uint96/uint64/uint32), so a result is a list of 32-byte big-endian
// integers. An empty or short result throws: a missing read must not turn into a zero counter.
export function words(hex: string, n: number): bigint[] {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length < 64 * n)
    throw new Error(`mhoc-desk: expected ${n} words, got 0x${h}`);
  return Array.from({ length: n }, (_, i) =>
    BigInt('0x' + h.slice(64 * i, 64 * (i + 1))),
  );
}

export const word = (hex: string): bigint => words(hex, 1)[0];

// how many words each read of snapshotCalls returns
export const SNAPSHOT_WORDS = [
  ...SNAPSHOT_VIEWS.map(m => (m === 'counters' ? 6 : 1)),
  1,
  1,
  1,
];

export function decodeSnapshot(
  returns: bigint[][],
  blockNumber: number,
): PropAMMSnapshot {
  if (
    returns.length !== SNAPSHOT_WORDS.length ||
    returns.some((r, i) => r.length !== SNAPSHOT_WORDS[i])
  )
    throw new Error('mhoc-desk: unexpected snapshot reads');
  const [
    [stateWord],
    [floorBase],
    [floorQuote],
    [maxNotional],
    [maxNotionalPerUpdate],
    [maxNotionalPerWindow],
    [cardSeq, cardFilled, fillBlock, blockFilled, windowId, windowFilled],
    [balanceBase],
    [balanceQuote],
    [readTimestamp],
  ] = returns;
  return {
    stateWord,
    floorBase,
    floorQuote,
    maxNotional,
    maxNotionalPerUpdate,
    maxNotionalPerWindow,
    cardSeq,
    cardFilled,
    fillBlock,
    blockFilled,
    windowId,
    windowFilled,
    balanceBase,
    balanceQuote,
    readTimestamp,
    blockNumber,
  };
}
