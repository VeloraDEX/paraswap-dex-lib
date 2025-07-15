export const BEBOP_INIT_TIMEOUT_MS = 5000;
export const BEBOP_PRICES_CACHE_TTL = 10;
export const BEBOP_TOKENS_CACHE_TTL = 60;
export const BEBOP_TOKENS_POLLING_INTERVAL_MS = 30 * 1000;
export const BEBOP_API_URL = 'https://api.bebop.xyz';
export const BEBOP_WS_API_URL = 'wss://api.bebop.xyz';
export const BEBOP_GAS_COST = 120_000;
export const BEBOP_QUOTE_TIMEOUT_MS = 3000;
export const BEBOP_ERRORS_CACHE_KEY = 'errors';
export const BEBOP_RESTRICTED_CACHE_KEY = 'restricted';
// Restrict for BEBOP_RESTRICT_TTL_S if an error occured >= BEBOP_RESTRICT_COUNT_THRESHOLD times within BEBOP_RESTRICT_CHECK_INTERVAL_S interval
export const BEBOP_RESTRICT_TTL_S = 10 * 60; // 10 min
export const BEBOP_RESTRICT_CHECK_INTERVAL_MS = 1000 * 60 * 3; // 3 min
export const BEBOP_RESTRICT_COUNT_THRESHOLD = 3;

export const SWAP_SINGLE_METHOD = 'swapSingle';
export const SWAP_AGGREGATE_METHOD = 'swapAggregate';

export const SWAP_SINGLE_METHOD_SELECTOR = '0x4dcebcba';
export const SWAP_AGGREGATE_METHOD_SELECTOR = '0xa2f74893';
