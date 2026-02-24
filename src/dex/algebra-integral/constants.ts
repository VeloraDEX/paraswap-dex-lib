export const ALGEBRA_QUOTE_GASLIMIT = 2_000_000;
export const ALGEBRA_GAS_COST = 180_000;
export const ALGEBRA_EFFICIENCY_FACTOR = 3;

// Minimum TVL in USD for a pool to be considered for pricing
export const MIN_USD_TVL_FOR_PRICING = 50_000; // $50,000

// TVL update interval in seconds
export const POOL_TVL_UPDATE_INTERVAL = 5 * 60; // 5 minutes

// Fee polling interval in milliseconds (slave only)
export const FEE_UPDATE_INTERVAL_MS = 60 * 1000; // 60 seconds

// Tick bitmap constants for event-based pricing (same as Algebra v1.9)
export const TICK_BITMAP_TO_USE = 400n;
export const TICK_BITMAP_BUFFER = 800n;
export const TICK_BITMAP_TO_USE_BY_CHAIN: Record<number, bigint> = {};
export const TICK_BITMAP_BUFFER_BY_CHAIN: Record<number, bigint> = {};
export const MAX_PRICING_COMPUTATION_STEPS_ALLOWED = 4096;
export const MAX_BATCH_SIZE = 100;
export const MAX_NUMBER_OF_BATCH_REQUEST_HALVING = 4;
