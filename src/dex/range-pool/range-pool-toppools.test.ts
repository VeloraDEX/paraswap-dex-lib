/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network } from '../../constants';
import { RangePool } from './range-pool';
import { PoolState } from './types';

const network = Network.MAINNET;
const dexKey = 'RangePool';

// Live mainnet Range Pool tokens (all lowercased to match cached pool state).
const ROME = '0x2bd1f344a2398340c2b1119da98816ea723f5f0f';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ROME_USDT_POOL = '0xaf037e69f0fa8d1633443cc0c67d0b73e3694b36';
const TOP_CRYPTO_POOL = '0x67c02fc8f5a4140077999014efa7fe9d0ee2f29b';

// THE Stage 6 gate: getTopPoolsForToken returns USD-ranked pools that each hold the queried
// token, sorted by descending liquidity within the limit — for ROME, USDT and WETH. Plus a
// fallback case with the API forced down, asserting the on-chain ranking still returns pools.
describe('RangePool — Stage 6: getTopPoolsForToken', () => {
  let dexHelper: DummyDexHelper;
  let rangePool: RangePool;
  let states: Record<string, PoolState>;

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    rangePool = new RangePool(network, dexKey, dexHelper);
    // Mirrors what the framework does before getTopPoolsForToken: a direct-RPC pool
    // refresh. Also seeds the on-chain fallback cache.
    await rangePool.updatePoolState();
    states = (rangePool as any).poolStates;
  });

  // Every returned pool must (a) exclude the queried token from its connectorTokens and
  // (b) actually contain the queried token — cross-checked against the on-chain cache.
  const assertWellFormed = (pools: any[], token: string, limit: number) => {
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.length).toBeLessThanOrEqual(limit);

    pools.forEach(p => {
      expect(p.exchange).toBe(dexKey);
      // Queried token is never echoed back as a connector token.
      expect(
        p.connectorTokens.some((t: any) => t.address.toLowerCase() === token),
      ).toBe(false);
      // Connector tokens carry a usable decimals field.
      p.connectorTokens.forEach((t: any) => {
        expect(typeof t.decimals).toBe('number');
      });
      // The pool genuinely holds the queried token (verified on-chain).
      const st = states[p.address.toLowerCase()];
      expect(st).toBeDefined();
      expect(st.tokens).toContain(token);
    });

    // Descending liquidity.
    for (let i = 1; i < pools.length; i++) {
      expect(pools[i - 1].liquidityUSD).toBeGreaterThanOrEqual(
        pools[i].liquidityUSD,
      );
    }
  };

  it('ROME: returns the ROME/USDT pool, USD-ranked', async () => {
    const pools = await rangePool.getTopPoolsForToken(ROME, 10);
    assertWellFormed(pools, ROME, 10);
    expect(pools.map(p => p.address.toLowerCase())).toContain(ROME_USDT_POOL);
    // USD liquidity comes straight from the API.
    expect(pools[0].liquidityUSD).toBeGreaterThan(0);
  });

  it('USDT: returns multiple pools, USD-ranked, respecting the limit', async () => {
    const pools = await rangePool.getTopPoolsForToken(USDT, 10);
    assertWellFormed(pools, USDT, 10);
    // USDT is shared across several pools.
    expect(pools.length).toBeGreaterThanOrEqual(2);

    // Limit is honoured.
    const capped = await rangePool.getTopPoolsForToken(USDT, 1);
    expect(capped.length).toBe(1);
    expect(capped[0].liquidityUSD).toBe(pools[0].liquidityUSD);
  });

  it('WETH: returns the TOP CRYPTO pool', async () => {
    const pools = await rangePool.getTopPoolsForToken(WETH, 10);
    assertWellFormed(pools, WETH, 10);
    expect(pools.map(p => p.address.toLowerCase())).toContain(TOP_CRYPTO_POOL);
  });

  it('falls back to on-chain ranking when the API is down', async () => {
    const spy = jest
      .spyOn(dexHelper.httpRequest, 'get')
      .mockRejectedValue(new Error('API down'));
    try {
      const pools = await rangePool.getTopPoolsForToken(USDT, 10);
      assertWellFormed(pools, USDT, 10);
      // The fallback ranks by a raw-balance proxy (> 0 for live pools).
      expect(pools[0].liquidityUSD).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });
});
