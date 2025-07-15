import BigNumber from 'bignumber.js';

export const DEXALOT_PRICES_CACHES_TTL_S = 5;

export const DEXALOT_PAIRS_CACHES_TTL_S = 21 * 60; // 21 mins

export const DEXALOT_TOKENS_CACHES_TTL_S = 21 * 60; // 21 mins

export const DEXALOT_BLACKLIST_CACHES_TTL_S = 180 * 60; // 3 hours

export const DEXALOT_API_PRICES_POLLING_INTERVAL_MS = 2000;

export const DEXALOT_API_PAIRS_POLLING_INTERVAL_MS = 1000 * 60 * 10; // 10 mins

export const DEXALOT_API_BLACKLIST_POLLING_INTERVAL_MS = 1000 * 60 * 60; // 1 hour

export const DEXALOT_API_URL = 'https://api.dexalot.com';

export const DEXALOT_GAS_COST = 120_000;

export const DEXALOT_RATE_LIMITED_TTL_S = 60 * 60; // 1 hour

export const DEXALOT_RATELIMIT_CACHE_VALUE = 'limited';

export const DEXALOT_RESTRICT_TTL_S = 60 * 30; // 30 minutes

export const DEXALOT_RESTRICTED_CACHE_KEY = 'restricted';

export const DEXALOT_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION =
  new BigNumber('0.005');

export const DEXALOT_FIRM_QUOTE_TIMEOUT_MS = 2000;
