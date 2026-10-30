import { Address, NumberAsString } from '../../types';

/**
 * What a Vurto quote hands back for tx building.
 *
 * It is deliberately the whole calldata rather than a set of hints. Vurto is an
 * aggregator: the route can be one venue or two venues chained inside one
 * transaction, and the leg array that encodes that is decided at quote time.
 * Re-deriving it here from hints would mean re-implementing our router's
 * encoding in two places, and the two would drift.
 */
export type VurtoData = {
  /** Always the VurtoSwapRouter for the chain. Also the spender. */
  exchange: Address;
  /** Ready-to-send calldata for the router. */
  calldata: string;
  /** Native value the call carries, "0" for ERC-20 input. */
  value: NumberAsString;
  /** Which venue (or venue pair) won this route, for logs and attribution. */
  venue: string;
  /** Unix seconds after which the quote must not be executed. */
  validUntil: number;
};

export type DexParams = {
  /** VurtoSwapRouter on this chain: the only target this integration uses. */
  router: Address;
  /** Base URL of the aggregator surface, e.g. https://swap.vurto.cc/gateway/v1 */
  gateway: string;
};

/** Shape of POST /gateway/v1/quote, trimmed to what this integration reads. */
export type VurtoQuoteResponse = {
  chainId: number;
  venue: string;
  amountOut: string;
  minAmountOut: string;
  estimatedGas: string;
  feeBps: number;
  priceImpact: number | null;
  spender: Address;
  tx: { to: Address; data: string; value: string };
  validUntil: number;
  approvalRequired: boolean;
};
