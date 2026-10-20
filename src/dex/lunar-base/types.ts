import { Address } from '../../types';

export type LunarBaseTokenConfig = {
  // Token address as Velora sees it (ETHER_ADDRESS for the native token).
  address: Address;
  // Token address as the pool sees it (NULL_ADDRESS for the native token).
  poolAddress: Address;
  decimals: number;
  symbol: string;
};

export type LunarBasePoolConfig = {
  address: Address;
  tokenX: LunarBaseTokenConfig;
  tokenY: LunarBaseTokenConfig;
};

export type DexParams = {
  pools: LunarBasePoolConfig[];
};

export type LunarBaseData = {
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  isXToY: boolean;
};

// `punishment`: current pools (linear anchor + per-swap directional punishment).
// `concentration`: legacy pools (concentrated curve, `concentrationK`).
export type LunarBasePricingModel = 'punishment' | 'concentration';

export type LunarBasePoolState = {
  model: LunarBasePricingModel;
  anchorPrice: bigint;
  feeAskX24: number;
  feeBidX24: number;
  latestUpdateBlock: number;
  reserveX: bigint;
  reserveY: bigint;
  blockDelay: number;
  maxPunishmentX24: number;
  concentrationK: number;
  // Fee multiplier charged to callers that are not whitelisted.
  blacklistFeeMultiplier: bigint;
  // Whitelist flag of every Velora executor that can call the pool, keyed by
  // lower-case address. The pool charges `blacklistFeeMultiplier` unless the
  // calling executor is whitelisted.
  executorsWhitelist: Record<Address, boolean>;
  paused: boolean;
};

export type LunarBaseQuoteResult = {
  amountOut: bigint;
  sqrtPriceNext: bigint;
  fee: bigint;
};
