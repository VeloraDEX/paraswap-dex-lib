// The price card (stateWord(), slot 0) is the only place the contract's bit layout appears; a new layout changes this
// file only. Layout, from the least significant bit:
//   [0,32) validUntil | [32,64) seq | [64,88) qMax | [88,104) kAsk | [104,120) kBid | [120,136) dAsk
//   | [136,152) dBid | [152,216) price | [216,248) validUntilBlock | [248,256) flags (bit 0 paused)

export type Card = {
  paused: boolean;
  price: bigint; // QUOTE raw units per whole BASE token, times PRICE_SCALE
  dBid: bigint; // 1e-6
  dAsk: bigint; // 1e-6
  kBid: bigint; // size slippage for takers who sell BASE, in units of K_SCALE
  kAsk: bigint; // size slippage for takers who buy BASE, in units of K_SCALE
  qMax: bigint; // whole QUOTE tokens
  seq: bigint;
  validUntil: bigint; // unix seconds
  validUntilBlock: bigint; // the last block number in which the card may trade
};

const mask = (bits: bigint) => (1n << bits) - 1n;

export function decodeCard(w: bigint): Card {
  return {
    paused: ((w >> 248n) & 1n) === 1n,
    validUntilBlock: (w >> 216n) & mask(32n),
    price: (w >> 152n) & mask(64n),
    dBid: (w >> 136n) & mask(16n),
    dAsk: (w >> 120n) & mask(16n),
    kBid: (w >> 104n) & mask(16n),
    kAsk: (w >> 88n) & mask(16n),
    qMax: (w >> 64n) & mask(24n),
    seq: (w >> 32n) & mask(32n),
    validUntil: w & mask(32n),
  };
}

// Both expiries must hold. The whole block number is compared with the 32-bit field, as the contract does.
export const isLive = (card: Card, blockNumber: bigint, now: bigint) =>
  now <= card.validUntil && blockNumber <= card.validUntilBlock;
