import { Address } from '../../types';

export type BaselineData = {
  // Baseline token being bought/sold; the reserve token is the counter-asset.
  // Swaps are always routed through the relay fixed in the DEX config.
  bToken: Address;
};

export type DexParams = {
  relay: Address;
  // GraphQL endpoint enumerating this chain's bTokens and their reserves.
  subgraphURL: string;
  // Optional priority pools, always tracked even if discovery is unavailable.
  bTokens?: Address[];
};

// The power-law curve parameters, all in 1e18 precision.
export type CurveParams = {
  blv: bigint;
  circ: bigint;
  supply: bigint;
  swapFee: bigint;
  reserves: bigint;
  totalSupply: bigint;
  convexityExp: bigint;
  lastInvariant: bigint;
};

// A pool's full pricing state for the current block, as returned by getQuoteState.
export type QuoteState = {
  snapshotCurveParams: CurveParams;
  quoteBlockBuyDeltaCirc: bigint;
  quoteBlockSellDeltaCirc: bigint;
  totalSupply: bigint;
  totalBTokens: bigint;
  totalReserves: bigint;
  reserveDecimals: number;
  liquidityFeePct: bigint;
  pendingSurplus: bigint;
  settlePendingSurplus: boolean;
  maxSellDelta: bigint;
  snapshotActivePrice: bigint;
};

// A single quote: `amount` is the priced value (output for a sell, input for a
// buy), `fee` the protocol fee.
export type QuoteResult = {
  amount: bigint;
  fee: bigint;
};
