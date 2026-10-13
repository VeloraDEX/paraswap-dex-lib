import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { PoolReservesNotReadyError } from '../../lib/pools-storage/reserves';
import {
  CURVE_API_POOLS_TTL_MS,
  CURVE_API_POOLS_TIMEOUT_MS,
} from './constants';
import {
  curveApiPoolReserves,
  curveApiPoolsUrl,
  fetchCurveApiPools,
  resetCurveApiPoolsCache,
} from './curve-api-pools';

const POOL = '0xAaaaAAAaaAAAaaaaAaaAAAaaaAaAAaaAAaAAAAAA';
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

const apiPool = (overrides: object = {}) => ({
  address: POOL,
  isBroken: false,
  coins: [
    { address: A, decimals: '18', poolBalance: '100' },
    { address: B, decimals: '6', poolBalance: '200' },
  ],
  ...overrides,
});

const response = (pools: object[]) => ({
  success: true,
  data: { poolData: pools },
});

describe('curve-api-pools', () => {
  const get = jest.fn();
  const dexHelper = { httpRequest: { get } } as unknown as IDexHelper;

  beforeEach(() => {
    get.mockReset();
    resetCurveApiPoolsCache();
    jest.useRealTimers();
  });

  describe('curveApiPoolsUrl', () => {
    it('builds the registry url for a known network', () => {
      expect(curveApiPoolsUrl(Network.MAINNET, '/main')).toEqual(
        'https://api.curve.finance/v1/getPools/ethereum/main',
      );
    });

    it('is null for a network the API does not serve', () => {
      expect(curveApiPoolsUrl(Network.BSC, '/main')).toBeNull();
    });

    it('applies per-network base url and slug restrictions', () => {
      expect(curveApiPoolsUrl(Network.PLASMA, '/factory-stable-ng')).toEqual(
        'https://api-core.curve.finance/v1/getPools/plasma/factory-stable-ng',
      );
      expect(curveApiPoolsUrl(Network.PLASMA, '/factory')).toBeNull();
    });
  });

  describe('fetchCurveApiPools', () => {
    it('indexes pools by lowercase address', async () => {
      get.mockResolvedValueOnce(response([apiPool()]));

      const pools = await fetchCurveApiPools(
        dexHelper,
        'CurveV1',
        Network.MAINNET,
        '/main',
      );

      expect(get).toHaveBeenCalledWith(
        'https://api.curve.finance/v1/getPools/ethereum/main',
        CURVE_API_POOLS_TIMEOUT_MS,
      );
      expect(Object.keys(pools!)).toEqual([POOL.toLowerCase()]);
    });

    it('serves repeated and concurrent calls from one request within the TTL', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      get.mockResolvedValue(response([apiPool()]));

      const [first, second] = await Promise.all([
        fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main'),
        fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main'),
      ]);
      await fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main');
      expect(get).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);

      jest.setSystemTime(1_000_000 + CURVE_API_POOLS_TTL_MS);
      await fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main');
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('caches per slug', async () => {
      get.mockResolvedValue(response([apiPool()]));
      await fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main');
      await fetchCurveApiPools(
        dexHelper,
        'CurveV1',
        Network.MAINNET,
        '/factory',
      );
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('rejects and retries later when the request fails', async () => {
      get.mockRejectedValueOnce(new Error('timeout'));
      get.mockResolvedValueOnce(response([apiPool()]));

      await expect(
        fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main'),
      ).rejects.toThrow(PoolReservesNotReadyError);

      expect(
        await fetchCurveApiPools(
          dexHelper,
          'CurveV1',
          Network.MAINNET,
          '/main',
        ),
      ).not.toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('rejects on an unexpected response shape', async () => {
      get.mockResolvedValueOnce({ success: false });
      await expect(
        fetchCurveApiPools(dexHelper, 'CurveV1', Network.MAINNET, '/main'),
      ).rejects.toThrow(PoolReservesNotReadyError);
    });

    it('returns null without a request for an unsupported network', async () => {
      expect(
        await fetchCurveApiPools(dexHelper, 'CurveV1', Network.BSC, '/main'),
      ).toBeNull();
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('curveApiPoolReserves', () => {
    it('maps coins to plain reserves with raw balances', () => {
      expect(curveApiPoolReserves('CurveV1', apiPool(), [A, B])).toEqual({
        dex: 'CurveV1',
        id: POOL.toLowerCase(),
        address: POOL.toLowerCase(),
        reserves: { [A]: '100', [B]: '200' },
      });
    });

    it('keeps only the coins the adapter supports, case-insensitively', () => {
      const C = '0x3333333333333333333333333333333333333333';
      const pool = apiPool({
        coins: [
          { address: A, decimals: '18', poolBalance: '100' },
          { address: B, decimals: '6', poolBalance: '200' },
          { address: C, decimals: '6', poolBalance: '300' },
        ],
      });
      expect(
        curveApiPoolReserves('CurveV1', pool, [A.toUpperCase(), B])!.reserves,
      ).toEqual({ [A]: '100', [B]: '200' });
    });

    it('skips broken pools and pools with fewer than two supported coins', () => {
      expect(
        curveApiPoolReserves('CurveV1', apiPool({ isBroken: true }), [A, B]),
      ).toBeNull();
      expect(curveApiPoolReserves('CurveV1', apiPool(), [A])).toBeNull();
    });
  });
});
