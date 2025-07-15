import BigNumber from 'bignumber.js';

/**
 * Cables
 */
export const CABLES_API_URL =
  'https://cables-evm-rfq-service.cryptosrvc.com/v1';

export const CABLES_PRICES_CACHES_TTL_S = 10;
export const CABLES_API_PRICES_POLLING_INTERVAL_MS = 2000; // 2 sec

export const CABLES_PAIRS_CACHES_TTL_S = 12;
export const CABLES_API_PAIRS_POLLING_INTERVAL_MS = 10000; // 10 sec

export const CABLES_BLACKLIST_CACHES_TTL_S = 60;
export const CABLES_API_BLACKLIST_POLLING_INTERVAL_MS = 30000; // 30 sec

export const CABLES_TOKENS_CACHES_TTL_S = 60;
export const CABLES_API_TOKENS_POLLING_INTERVAL_MS = 30000; // 30 sec

export const CABLES_FIRM_QUOTE_TIMEOUT_MS = 2000;

export const CABLES_RESTRICTED_CACHE_KEY = 'restricted';

export const CABLES_ERRORS_CACHE_KEY = 'errors';

export const CABLES_RESTRICT_CHECK_INTERVAL_MS = 1000 * 60 * 3; // 3 min

export const CABLES_RESTRICT_COUNT_THRESHOLD = 3;

export const CABLES_RESTRICT_TTL_S = 10 * 60; // 10 min

export const CABLES_GAS_COST = 120_000;
