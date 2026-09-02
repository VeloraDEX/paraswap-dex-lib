import { Address } from '../../types';

// Per-network fork parameters (our custom, non-canonical Balancer V3 stack).
export type DexParams = {
  vaultAddress: Address;
  routerAddress: Address;
  factoryAddress: Address;
  hookAddress: Address;
  permit2Address: Address;
  // ranges-stats API base URL — used only by getTopPoolsForToken (Stage 6).
  apiBaseUrl: string;
};

// Full event-subscriber state for one pool: the minimum set needed to price a
// swap. Immutable fields come from getRangePoolImmutableData; the rest from
// getRangePoolDynamicData. All vectors are in token registration order; weights,
// virtual/fact balances, rates and the swap fee are scaled18.
export type PoolState = {
  // immutable
  tokens: Address[]; // lowercased
  scalingFactors: bigint[]; // raw -> scaled18 multipliers (e.g. 1e12 for 6-decimals)
  weights: bigint[]; // normalized weights, scaled18

  // mutable
  virtualBalances: bigint[]; // scaled18
  balancesLiveScaled18: bigint[]; // fact balances, scaled18
  tokenRates: bigint[]; // scaled18 (1e18 for standard tokens; Range disallows yield)
  swapFeePercentage: bigint; // staticSwapFeePercentage, scaled18
  // Aggregate (protocol + pool-creator) swap-fee share, scaled18. Lives in the Vault
  // PoolConfig (getPoolConfig), NOT in getRangePoolDynamicData. Needed by the event
  // reducer to split LP vs aggregate fees on every swap / liquidity log (Stage 4).
  aggregateSwapFee: bigint;
  // Vault-global MINIMUM_TRADE_AMOUNT (scaled18). Our custom Vault uses 1e12, NOT
  // Balancer's canonical 1e6. The Vault reverts (TradeAmountTooSmall) when the scaled
  // input OR output of a swap is below it, so the quote math must gate on it — otherwise
  // dust trades price on our side while reverting on-chain.
  minimumTradeAmount: bigint;
  totalSupply: bigint;

  // liveness flags — any "unsafe" one => treat the pool as zero liquidity
  isPoolRegistered: boolean;
  isPoolInitialized: boolean;
  isPoolPaused: boolean;
  isPoolInRecoveryMode: boolean;
  isVaultPaused: boolean;
  isHookStopped: boolean;
};

// Minimal data carried from getPricesVolume -> getDexParam for settlement (Stage 5).
export type RangePoolData = {
  exchange: Address; // the Range Pool address
};
