import dotenv from 'dotenv';
dotenv.config();

// these tests never hit the network, a provider url is only needed for the
// shared config validation to pass when the dex helper is instantiated
process.env.HTTP_PROVIDER_1 =
  process.env.HTTP_PROVIDER_1 || 'http://localhost:8545';

import { DummyDexHelper } from '../../dex-helper';
import { Network, NULL_ADDRESS } from '../../constants';
import { Token } from '../../types';
import { parsePairCacheRecord, UniswapV2 } from './uniswap-v2';

const RECHECK_PAIR_EXISTENCE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const network = Network.MAINNET;
const dexKey = 'UniswapV2';

// token0 is the lowest address, as sorted by findPair
const token0: Token = {
  address: '0x1111111111111111111111111111111111111111',
  decimals: 18,
};
const token1: Token = {
  address: '0x2222222222222222222222222222222222222222',
  decimals: 6,
};

const exchange = '0x3333333333333333333333333333333333333333';

describe('UniswapV2 pairs cache', () => {
  let dexHelper: DummyDexHelper;
  let uniswapV2: UniswapV2;
  let getPair: jest.Mock;
  let key: string;

  const seedCache = (value: unknown) =>
    dexHelper.cache.hset(
      uniswapV2.pairsHashCacheKey,
      key,
      JSON.stringify(value),
    );

  const readCache = () =>
    dexHelper.cache.hget(uniswapV2.pairsHashCacheKey, key);

  beforeAll(() => {
    // the dex helper schedules recurring work through setTimeout, faking timers
    // keeps it from holding the event loop open once the suite is done
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    dexHelper = new DummyDexHelper(network);
    uniswapV2 = new UniswapV2(network, dexKey, dexHelper);

    getPair = jest.fn().mockReturnValue({ call: async () => NULL_ADDRESS });
    (uniswapV2 as any).factory = { methods: { getPair } };

    key = (uniswapV2 as any).getPoolIdentifier(token0.address, token1.address);
  });

  it('serves a fresh negative record from the cache without calling the factory', async () => {
    const checkExistenceAfter = Date.now() + RECHECK_PAIR_EXISTENCE_AFTER_MS;
    await seedCache({ checkExistenceAfter });

    const pair = await uniswapV2.findPair(token0, token1);

    expect(pair).toEqual({ token0, token1, checkExistenceAfter });
    expect(pair!.exchange).toBeUndefined();
    expect(getPair).not.toHaveBeenCalled();
  });

  it('re-checks an expired negative record on chain and stores only the minimal record', async () => {
    await seedCache({ checkExistenceAfter: Date.now() - 1 });

    const pair = await uniswapV2.findPair(token0, token1);

    expect(getPair).toHaveBeenCalledWith(token0.address, token1.address);
    expect(pair).toEqual({ token0, token1 });

    const cached = JSON.parse((await readCache())!);
    expect(Object.keys(cached).sort()).toEqual(['checkExistenceAfter']);
    expect(cached.checkExistenceAfter).toBeGreaterThan(Date.now());
  });

  it('serves a positive record from the cache even once it would need a re-check', async () => {
    const checkExistenceAfter = Date.now() - 1;
    await seedCache({ exchange, checkExistenceAfter });

    const pair = await uniswapV2.findPair(token0, token1);

    expect(pair).toEqual({ token0, token1, exchange, checkExistenceAfter });
    expect(getPair).not.toHaveBeenCalled();
  });

  it('stores only exchange and checkExistenceAfter for a discovered pair', async () => {
    getPair.mockReturnValue({ call: async () => exchange });

    const pair = await uniswapV2.findPair(token0, token1);

    expect(pair).toEqual({ token0, token1, exchange });

    const cached = JSON.parse((await readCache())!);
    expect(Object.keys(cached).sort()).toEqual([
      'checkExistenceAfter',
      'exchange',
    ]);
    expect(cached.exchange).toEqual(exchange);
  });

  describe('backward compatibility with legacy (fat) cache entries', () => {
    // the shape written before the cached record was trimmed down
    const legacyEntry = (extra: Record<string, unknown>) => ({
      token0: { address: token0.address, decimals: 0, symbol: 'STALE' },
      token1: { address: token1.address, decimals: 0, symbol: 'STALE' },
      ...extra,
    });

    it('reads a legacy positive entry and rebuilds the pair from the given tokens', async () => {
      const checkExistenceAfter = Date.now() + RECHECK_PAIR_EXISTENCE_AFTER_MS;
      await seedCache(legacyEntry({ exchange, checkExistenceAfter }));

      const pair = await uniswapV2.findPair(token0, token1);

      // tokens come from the caller, not from the stale cached copies
      expect(pair).toEqual({ token0, token1, exchange, checkExistenceAfter });
      expect(getPair).not.toHaveBeenCalled();
    });

    it('reads a legacy fresh negative entry', async () => {
      const checkExistenceAfter = Date.now() + RECHECK_PAIR_EXISTENCE_AFTER_MS;
      await seedCache(legacyEntry({ checkExistenceAfter }));

      const pair = await uniswapV2.findPair(token0, token1);

      expect(pair).toEqual({ token0, token1, checkExistenceAfter });
      expect(getPair).not.toHaveBeenCalled();
    });

    it('re-checks a legacy expired negative entry and rewrites it in the minimal shape', async () => {
      await seedCache(legacyEntry({ checkExistenceAfter: Date.now() - 1 }));

      await uniswapV2.findPair(token0, token1);

      expect(getPair).toHaveBeenCalledTimes(1);
      expect(Object.keys(JSON.parse((await readCache())!))).toEqual([
        'checkExistenceAfter',
      ]);
    });
  });

  it('treats a malformed cache entry as a miss instead of throwing', async () => {
    await dexHelper.cache.hset(uniswapV2.pairsHashCacheKey, key, '{not json');

    const pair = await uniswapV2.findPair(token0, token1);

    expect(pair).toEqual({ token0, token1 });
    expect(getPair).toHaveBeenCalledTimes(1);
  });
});

describe('parsePairCacheRecord', () => {
  it('returns null for missing or malformed entries', () => {
    expect(parsePairCacheRecord(null)).toBeNull();
    expect(parsePairCacheRecord('')).toBeNull();
    expect(parsePairCacheRecord('{"exchange":')).toBeNull();
    expect(parsePairCacheRecord('"a string"')).toBeNull();
    expect(parsePairCacheRecord('null')).toBeNull();
  });

  it('keeps only the fields that are read back', () => {
    expect(
      parsePairCacheRecord(
        JSON.stringify({
          token0,
          token1,
          exchange,
          checkExistenceAfter: 42,
          pool: {},
        }),
      ),
    ).toEqual({ exchange, checkExistenceAfter: 42 });
  });

  it('defaults a missing checkExistenceAfter to an already expired value', () => {
    expect(parsePairCacheRecord(JSON.stringify({}))).toEqual({
      checkExistenceAfter: 0,
    });
  });
});
