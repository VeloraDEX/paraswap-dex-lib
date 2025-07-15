export const PANCAKESWAPV3_TICK_GAS_COST = 24_000; // Ceiled
export const PANCAKESWAPV3_TICK_BASE_OVERHEAD = 75_000;
export const PANCAKESWAPV3_POOL_SEARCH_OVERHEAD = 10_000;

// This is used for price calculation. If out of scope, return 0n
export const TICK_BITMAP_TO_USE = 4n;

// This is used to check if the state is still valid.
export const TICK_BITMAP_BUFFER = 8n;

export const MAX_PRICING_COMPUTATION_STEPS_ALLOWED = 128;

export const PANCAKESWAPV3_SUBGRAPH_URL =
  '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

export const PANCAKESWAPV3_EFFICIENCY_FACTOR = 3;

export const ZERO_TICK_INFO = {
  liquidityGross: 0n,
  liquidityNet: 0n,
  tickCumulativeOutside: 0n,
  secondsPerLiquidityOutsideX128: 0n,
  secondsOutside: 0n,
  initialized: false,
};

export const ZERO_ORACLE_OBSERVATION = {
  blockTimestamp: 0n,
  tickCumulative: 0n,
  secondsPerLiquidityCumulativeX128: 0n,
  initialized: false,
};

export const OUT_OF_RANGE_ERROR_POSTFIX = `INVALID_TICK_BIT_MAP_RANGES`;

export const DEFAULT_POOL_INIT_CODE_HASH = `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54`;

export const INACTIVE_POOL_AGE_MS = 3 * 30 * 24 * 60 * 60 * 1000; // 3 months
