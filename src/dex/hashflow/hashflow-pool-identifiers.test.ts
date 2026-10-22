import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { CACHE_PREFIX, Network, SwapSide } from '../../constants';
import { Hashflow } from './hashflow';

const network = Network.MAINNET;
const dexKey = 'Hashflow';

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const ZRO = '0x6985884c4392d348587b19cb9eaaf157f13271cd';

const entry = (baseToken: string, quoteToken: string) => ({
  pair: { baseToken, quoteToken },
  levels: [
    { q: '0', p: '0.49' },
    { q: '100000', p: '0.49' },
  ],
});

const token = (address: string) => ({ address, decimals: 6 });

async function buildHashflow() {
  const dexHelper = new DummyDexHelper(network);
  dexHelper.config.data.hashFlowAuthToken = 'test';
  const hashflow = new Hashflow(network, dexKey, dexHelper);

  // Two market makers quoting ZRO against both USDC and USDT.
  await dexHelper.cache.rawset(
    `${CACHE_PREFIX}_${network}_${dexKey}_prices`,
    JSON.stringify({
      mm22: [entry(USDC, ZRO), entry(USDT, ZRO)],
      mm46_1: [entry(USDC, ZRO), entry(USDT, ZRO)],
    }),
    10,
  );

  return hashflow;
}

describe('Hashflow pool identifiers', () => {
  it('advertises one pool per destination token, whatever the input token', async () => {
    const hashflow = await buildHashflow();

    const fromUsdc = await hashflow.getPoolIdentifiers(
      token(USDC),
      token(ZRO),
      SwapSide.SELL,
      0,
    );
    const fromUsdt = await hashflow.getPoolIdentifiers(
      token(USDT),
      token(ZRO),
      SwapSide.SELL,
      0,
    );

    expect(fromUsdc).toEqual([`hashflow_${ZRO}`]);
    expect(fromUsdt).toEqual(fromUsdc);
  });

  it('advertises nothing when no maker quotes the pair', async () => {
    const hashflow = await buildHashflow();

    await expect(
      hashflow.getPoolIdentifiers(token(ZRO), token(USDC), SwapSide.SELL, 0),
    ).resolves.toEqual([]);
  });

  it('prices every maker with a unique identifier when the pool is allowed', async () => {
    const hashflow = await buildHashflow();

    const prices = await hashflow.getPricesVolume(
      token(USDC),
      token(ZRO),
      [0n, 1000000n],
      SwapSide.SELL,
      0,
      [`hashflow_${ZRO}`],
    );

    expect(prices?.map(p => p.data.mm)).toEqual(['mm22', 'mm46_1']);
    expect(prices?.map(p => p.poolIdentifiers)).toEqual([
      [`hashflow_${ZRO}_mm22`],
      [`hashflow_${ZRO}_mm46_1`],
    ]);
  });

  it('returns no prices when another route already claimed the pool', async () => {
    const hashflow = await buildHashflow();

    await expect(
      hashflow.getPricesVolume(
        token(USDT),
        token(ZRO),
        [0n, 1000000n],
        SwapSide.SELL,
        0,
        [],
      ),
    ).resolves.toBeNull();
  });
});
