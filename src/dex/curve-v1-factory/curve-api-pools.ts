import { IDexHelper } from '../../dex-helper';
import { Logger, PoolReserves } from '../../types';
import { toReserves } from '../../lib/pools-storage';
import {
  CURVE_API_BY_NETWORK,
  CURVE_API_POOLS_TIMEOUT_MS,
  CURVE_API_POOLS_TTL_MS,
  CURVE_API_SLUGS_BY_NETWORK,
  CURVE_API_URL,
  NETWORK_ID_TO_NAME,
} from './constants';

export type CurveApiPoolCoin = {
  address: string;
  decimals: string;
  poolBalance: string;
};

export type CurveApiPool = {
  address: string;
  isBroken?: boolean;
  coins: CurveApiPoolCoin[];
};

type CurveApiResponse = {
  success: boolean;
  data: { poolData: CurveApiPool[] };
};

// Pools keyed by lowercase address.
export type CurveApiPools = Record<string, CurveApiPool>;

type CacheEntry = {
  fetchedAt: number;
  pools: Promise<CurveApiPools | null>;
};

// One cache per process: CurveV1, CurveV1Factory and CurveV1StableNg share
// the registry responses, so the API is hit once per slug per TTL however
// many classes or callers ask.
const cache = new Map<string, CacheEntry>();

export function resetCurveApiPoolsCache() {
  cache.clear();
}

// `null` when the network is unknown to the API or the slug is not served
// for it.
export function curveApiPoolsUrl(network: number, slug: string): string | null {
  const networkName = NETWORK_ID_TO_NAME[network];
  if (!networkName) return null;

  const allowedSlugs = CURVE_API_SLUGS_BY_NETWORK[network];
  if (allowedSlugs && !allowedSlugs.includes(slug)) return null;

  const baseUrl = CURVE_API_BY_NETWORK[network] ?? CURVE_API_URL;
  return `${baseUrl}/${networkName}${slug}`;
}

// Fetches `getPools/<network><slug>` with an in-process TTL cache and
// in-flight deduplication. A failed request resolves to `null` and is not
// cached, so the next caller retries.
export function fetchCurveApiPools(
  dexHelper: IDexHelper,
  network: number,
  slug: string,
  logger: Logger,
): Promise<CurveApiPools | null> {
  const url = curveApiPoolsUrl(network, slug);
  if (!url) return Promise.resolve(null);

  const now = Date.now();
  const cached = cache.get(url);
  if (cached && now - cached.fetchedAt < CURVE_API_POOLS_TTL_MS) {
    return cached.pools;
  }

  const pools = dexHelper.httpRequest
    .get<CurveApiResponse>(url, CURVE_API_POOLS_TIMEOUT_MS)
    .then(response => {
      if (!response.success || !Array.isArray(response.data?.poolData)) {
        throw new Error('unexpected response shape');
      }
      const byAddress: CurveApiPools = {};
      for (const pool of response.data.poolData) {
        byAddress[pool.address.toLowerCase()] = pool;
      }
      return byAddress;
    })
    .catch(e => {
      cache.delete(url);
      logger.error(`fetchCurveApiPools ${url} failed:`, e);
      return null;
    });

  cache.set(url, { fetchedAt: now, pools });
  return pools;
}

// Plain reserves over the pool's own coins: every coin swaps to every other
// one, and `poolBalance` is the raw payout capacity of that coin. Metapool
// underlying swaps are not listed; the base pool is reported as its own
// pool. `null` for a broken pool or one with fewer than two coins.
export function curveApiPoolReserves(
  dexKey: string,
  pool: CurveApiPool,
): PoolReserves | null {
  if (pool.isBroken || pool.coins.length < 2) return null;

  const address = pool.address.toLowerCase();
  return {
    dex: dexKey,
    id: address,
    address,
    reserves: toReserves(
      pool.coins.map(c => c.address),
      pool.coins.map(c => BigInt(c.poolBalance)),
    ),
  };
}
