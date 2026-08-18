import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Bebop } from './bebop';
import { BebopPair, BebopPricingResponse } from './types';
import { pairPricesCacheKey, pairsIndexCacheKey } from './rate-fetcher';

const network = Network.MAINNET;
const dexKey = 'Bebop';
const pricesCacheKey = 'prices';

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const UNRELATED = '0x1111111111111111111111111111111111111111';

const book = (price: number): BebopPair => ({
  bids: [[price, 10]],
  asks: [[price * 1.001, 10]],
  last_update_ts: 1,
});

const token = (address: string) => ({ address, decimals: 18 });

function buildBebop() {
  const dexHelper = new DummyDexHelper(network);
  dexHelper.config.data.bebopAuthName = 'test';
  dexHelper.config.data.bebopAuthToken = 'test';

  return { dexHelper, bebop: new Bebop(network, dexKey, dexHelper) };
}

async function seedPerPair(
  dexHelper: DummyDexHelper,
  prices: BebopPricingResponse,
) {
  const pairs = Object.keys(prices);

  for (const pair of pairs) {
    await dexHelper.cache.rawset(
      pairPricesCacheKey(dexKey, network, pricesCacheKey, pair),
      JSON.stringify(prices[pair]),
      10,
    );
  }

  await dexHelper.cache.rawset(
    pairsIndexCacheKey(dexKey, network, pricesCacheKey),
    JSON.stringify(pairs),
    10,
  );
}

describe('Bebop per-pair price cache', () => {
  it('reads only the pairs relevant to the swap', async () => {
    const { dexHelper, bebop } = buildBebop();

    await seedPerPair(dexHelper, {
      [`${WBTC}/${USDC}`]: book(60000),
      [`${WBTC}/${WETH}`]: book(20),
      [`${UNRELATED}/${USDC}`]: book(5),
    });

    const mget = jest.spyOn(dexHelper.cache, 'mgetAndCacheLocally');

    const prices = await bebop.getCachedPricesForPairs(
      // mirrors getRelevantPairs for WBTC -> USDC
      [
        `${WBTC}/${USDC}`,
        `${USDC}/${WBTC}`,
        `${WBTC}/${USDT}`,
        `${WBTC}/${WETH}`,
      ],
    );

    expect(Object.keys(prices!).sort()).toEqual(
      [`${WBTC}/${USDC}`, `${WBTC}/${WETH}`].sort(),
    );
    // the unrelated pair is never fetched
    expect(mget.mock.calls[0][0]).not.toContain(
      pairPricesCacheKey(
        dexKey,
        network,
        pricesCacheKey,
        `${UNRELATED}/${USDC}`,
      ),
    );
  });

  it('requests direct, inverse and every middle-token leg', async () => {
    const { dexHelper, bebop } = buildBebop();
    await seedPerPair(dexHelper, { [`${WBTC}/${USDC}`]: book(60000) });

    const mget = jest.spyOn(dexHelper.cache, 'mgetAndCacheLocally');
    await bebop.getPoolIdentifiers(token(WBTC), token(USDC), SwapSide.SELL, 0);

    const requested = mget.mock.calls[0][0];
    const key = (pair: string) =>
      pairPricesCacheKey(dexKey, network, pricesCacheKey, pair);

    // exactly: direct, inverse, and both legs through each of the three
    // mainnet middle tokens — deduped, since USDC is itself one of them
    expect(new Set(requested)).toEqual(
      new Set([
        key(`${WBTC}/${USDC}`),
        key(`${USDC}/${WBTC}`),
        key(`${WBTC}/${USDT}`),
        key(`${USDC}/${USDT}`),
        key(`${WBTC}/${WETH}`),
        key(`${USDC}/${WETH}`),
        key(`${USDC}/${USDC}`),
      ]),
    );
    expect(new Set(requested).size).toEqual(requested.length);
  });

  it('yields no pools rather than throwing when the cache is empty', async () => {
    const { bebop } = buildBebop();

    // nothing seeded at all — writer down, or Bebop quotes neither token
    await expect(
      bebop.getPoolIdentifiers(token(WBTC), token(USDC), SwapSide.SELL, 0),
    ).resolves.toEqual([]);
  });

  it('returns null from getAllCachedPrices when the index is gone', async () => {
    const { bebop } = buildBebop();

    await expect(bebop.getAllCachedPrices()).resolves.toBeNull();
  });

  it('still prices correctly through the per-pair cache', async () => {
    const { dexHelper, bebop } = buildBebop();
    await seedPerPair(dexHelper, { [`${WBTC}/${USDC}`]: book(60000) });

    const pools = await bebop.getPoolIdentifiers(
      token(WBTC),
      token(USDC),
      SwapSide.SELL,
      0,
    );

    // dexKey keeps its casing, addresses are lowercased
    expect(pools).toEqual([`${dexKey}_${WBTC}_${USDC}`]);
  });

  it('rebuilds the whole book from the index for getTopPoolsForToken', async () => {
    const { dexHelper, bebop } = buildBebop();

    await seedPerPair(dexHelper, {
      [`${WBTC}/${USDC}`]: book(60000),
      [`${WETH}/${USDC}`]: book(3000),
      [`${UNRELATED}/${USDC}`]: book(5),
    });

    const prices = await bebop.getAllCachedPrices();

    expect(Object.keys(prices!).sort()).toEqual(
      [`${WBTC}/${USDC}`, `${WETH}/${USDC}`, `${UNRELATED}/${USDC}`].sort(),
    );
  });
});
