import BigNumber from 'bignumber.js';

export const SWAAP_RFQ_PRICES_CACHES_TTL_S = 3;

export const SWAAP_RFQ_QUOTE_TIMEOUT_MS = 3000;

export const SWAAP_RFQ_API_PRICES_POLLING_INTERVAL_MS = 1000;

export const SWAAP_RFQ_API_TOKENS_POLLING_INTERVAL_MS = 1000 * 60 * 60; // 1 hour

export const SWAAP_RFQ_TOKENS_CACHES_TTL_S = 7200; // 2 hours

export const SWAAP_RFQ_API_URL = 'https://api.swaap.finance/v1/rfq';

export const SWAAP_TOKENS_CACHE_KEY = 'tokens';

export const SWAAP_PRICES_CACHE_KEY = 'prices';

export const SWAAP_RFQ_PRICES_ENDPOINT = 'prices';

export const SWAAP_RFQ_QUOTE_ENDPOINT = 'quote';

export const SWAAP_NOTIFY_ENDPOINT = 'notify';

export const SWAAP_RFQ_TOKENS_ENDPOINT = 'tokens';

export const SWAAP_403_TTL_S = 60 * 60 * 24; // 24 hours

export const SWAAP_429_TTL_S = 60 * 60 * 1; // 1 hour

export const SWAAP_POOL_RESTRICT_TTL_S = 60 * 30; // 30 minutes

export const STABLE_SWAP_GAS_COST_ESTIMATION = 130_000;

export const VOLATILE_SWAP_GAS_COST_ESTIMATION = 150_000;

export const BATCH_SWAP_SELECTOR = '0x945bcec9';

export const CALLER_SLOT = 160;

export const SWAAP_ORDER_TYPE_SELL = 1;

export const SWAAP_ORDER_TYPE_BUY = 2;

export const SWAAP_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION =
  new BigNumber('0.001');

export const SWAAP_NOTIFY_TIMEOUT_MS = 2000;

export const SWAAP_NOTIFICATION_ORIGIN = 'paraswap';

export const SWAAP_BANNED_CODE = 1;
