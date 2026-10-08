import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { Logger } from '../../types';
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
  const logger = { error: jest.fn() } as unknown as Logger;

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
        Network.MAINNET,
        '/main',
        logger,
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
        fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger),
        fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger),
      ]);
      await fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger);
      expect(get).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);

      jest.setSystemTime(1_000_000 + CURVE_API_POOLS_TTL_MS);
      await fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('caches per slug', async () => {
      get.mockResolvedValue(response([apiPool()]));
      await fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger);
      await fetchCurveApiPools(dexHelper, Network.MAINNET, '/factory', logger);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('returns null and retries later when the request fails', async () => {
      get.mockRejectedValueOnce(new Error('timeout'));
      get.mockResolvedValueOnce(response([apiPool()]));

      expect(
        await fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger),
      ).toBeNull();
      expect(logger.error).toHaveBeenCalled();

      expect(
        await fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger),
      ).not.toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('returns null on an unexpected response shape', async () => {
      get.mockResolvedValueOnce({ success: false });
      expect(
        await fetchCurveApiPools(dexHelper, Network.MAINNET, '/main', logger),
      ).toBeNull();
    });

    it('returns null without a request for an unsupported network', async () => {
      expect(
        await fetchCurveApiPools(dexHelper, Network.BSC, '/main', logger),
      ).toBeNull();
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('curveApiPoolReserves', () => {
    it('maps coins to plain reserves with raw balances', () => {
      expect(curveApiPoolReserves('CurveV1', apiPool())).toEqual({
        dex: 'CurveV1',
        id: POOL.toLowerCase(),
        address: POOL.toLowerCase(),
        reserves: { [A]: '100', [B]: '200' },
      });
    });

    it('skips broken pools and pools with a single coin', () => {
      expect(
        curveApiPoolReserves('CurveV1', apiPool({ isBroken: true })),
      ).toBeNull();
      expect(
        curveApiPoolReserves(
          'CurveV1',
          apiPool({
            coins: [{ address: A, decimals: '18', poolBalance: '1' }],
          }),
        ),
      ).toBeNull();
    });
  });
});
