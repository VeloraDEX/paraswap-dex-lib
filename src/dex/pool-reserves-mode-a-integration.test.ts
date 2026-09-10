import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../dex-helper/index';
import { Network, SwapSide } from '../constants';
import { Tokens } from '../../tests/constants-e2e';
import { expectPoolReserves } from '../../tests/utils-pool-reserves';
import { UniswapV2 } from './uniswap-v2/uniswap-v2';
import { PancakeSwapV2 } from './uniswap-v2/pancake-swap-v2';
import { VelodromeV2 } from './solidly/forks-override/velodromeV2';

// Storage-mode adapters against live RPC: descriptors are taken from the
// `_pairs` hash the dex itself writes into the (dummy) cache, then fed back
// through `getPoolReserves`, covering both the event-state hit path and the
// `getReserves()` fallback.

jest.setTimeout(120 * 1000);

const lc = (a: string) => a.toLowerCase();
const isPositive = (v: string) => /^[1-9][0-9]*$/.test(v);

async function storedDescriptors(
  dexHelper: DummyDexHelper,
  key: string,
): Promise<Record<string, string>> {
  return dexHelper.cache.hgetAll(key);
}

describe('pool reserves: storage mode (UniswapV2 / Solidly)', () => {
  it('UniswapV2: event-state hit and RPC miss from _pairs descriptors', async () => {
    const network = Network.MAINNET;
    const dexKey = 'UniswapV2';
    const dexHelper = new DummyDexHelper(network);
    const dex = new UniswapV2(network, dexKey, dexHelper);
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    await dex.initializePricing(blockNumber);

    const { WETH, USDC, DAI } = Tokens[network];

    // pricing creates the event pool → hit path
    await dex.getPricesVolume(
      WETH,
      USDC,
      [0n, 10n ** 18n],
      SwapSide.SELL,
      blockNumber,
    );
    // discovery only → descriptor without in-memory state → RPC path
    await dex.findPair(WETH, DAI);

    const storage = dex.getPoolsStorage();
    const stored = await storedDescriptors(dexHelper, storage.key);
    const fields = Object.keys(stored);
    expect(fields).toHaveLength(2);

    const reserves = await dex.getPoolReserves(Object.values(stored));
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(2);
    expect(new Set(reserves.map(r => r.id))).toEqual(new Set(fields));
    for (const pool of reserves) {
      const tokens = Object.keys(pool.reserves);
      expect(tokens).toHaveLength(2);
      expect(tokens).toContain(lc(WETH.address));
      tokens.forEach(t => expect(isPositive(pool.reserves[t])).toBeTruthy());
    }
  });

  it('Aerodrome: stable and volatile pools of one pair get distinct ids', async () => {
    const network = Network.BASE;
    const dexKey = 'Aerodrome';
    const dexHelper = new DummyDexHelper(network);
    const dex = new VelodromeV2(network, dexKey, dexHelper);
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    await dex.initializePricing(blockNumber);

    const { USDC, USDbC } = Tokens[network];
    const pairs = await dex.findSolidlyPairs(USDC, USDbC);
    const existing = pairs.filter(p => p.exchange);
    expect(existing.length).toBeGreaterThan(0);

    const stored = await storedDescriptors(
      dexHelper,
      dex.getPoolsStorage().key,
    );
    const reserves = await dex.getPoolReserves(Object.values(stored));
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(existing.length);

    const suffixes = reserves.map(r => r.id.slice(-1)).sort();
    expect(suffixes).toEqual(existing.map(p => (p.stable ? 'S' : 'U')).sort());
    expect(new Set(reserves.map(r => r.address))).toEqual(
      new Set(existing.map(p => lc(p.exchange!))),
    );
    for (const pool of reserves) {
      expect(Object.keys(pool.reserves).sort()).toEqual(
        [lc(USDC.address), lc(USDbC.address)].sort(),
      );
    }
  });

  it('PancakeSwapV2: index-keyed _pools descriptors fall back to RPC when the tracker map is empty', async () => {
    const network = Network.BSC;
    const dexKey = 'PancakeSwapV2';
    const dexHelper = new DummyDexHelper(network);
    const dex = new PancakeSwapV2(network, dexKey, dexHelper);

    expect(dex.getPoolsStorage().fieldInValue).toBeFalsy();

    // the writer is master-only; emulate one stored entry and the consumer's
    // `{ i: field, ...value }` wrapping
    const fetched = await dex.fetchPools(0, 2);
    const descriptors = Object.entries(fetched).map(([i, pool]) =>
      JSON.stringify({ i, ...pool, updatedAt: Date.now() }),
    );

    const reserves = await dex.getPoolReserves(descriptors);
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(descriptors.length);
    reserves.forEach((pool, idx) => {
      const source = fetched[idx];
      expect(pool.id).toEqual(String(idx));
      expect(pool.address).toEqual(lc(source.address));
      expect(Object.keys(pool.reserves).sort()).toEqual(
        [lc(source.token0.address), lc(source.token1.address)].sort(),
      );
    });
  });
});
