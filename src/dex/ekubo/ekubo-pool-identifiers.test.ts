import dotenv from 'dotenv';
dotenv.config();

import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { Token } from '../../types';
import { DEX_KEY } from './config';
import { Ekubo } from './ekubo';
import { IEkuboPool } from './pools/pool';
import { PoolConfig, PoolKey } from './pools/utils';
import { convertEkuboToParaSwap } from './utils';

const ETH = 0n;
const USDC = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n;
const USDT = 0xdac17f958d2ee523a2206206994597c13d831ec7n;
const WBTC = 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599n;

function token(address: bigint): Token {
  return { address: convertEkuboToParaSwap(address), decimals: 18 };
}

function poolKey(token0: bigint, token1: bigint, fee: bigint): PoolKey {
  return new PoolKey(token0, token1, new PoolConfig(0n, fee, 200));
}

describe('Ekubo getPoolIdentifiers', () => {
  let ekubo: Ekubo;

  // DummyDexHelper starts a PromiseScheduler that reschedules itself forever
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['nextTick'] }));
  afterAll(() => jest.useRealTimers());

  const trackPool = (key: PoolKey) =>
    (ekubo as any).trackPool(key.stringId, { key } as IEkuboPool);

  const getPoolIdentifiers = (a: bigint, b: bigint) =>
    ekubo.getPoolIdentifiers(token(a), token(b), SwapSide.SELL, 0);

  beforeEach(() => {
    ekubo = new Ekubo(
      Network.MAINNET,
      DEX_KEY,
      new DummyDexHelper(Network.MAINNET),
    );
    (ekubo as any).poolKeysSynced = true;
  });

  it('returns only the pools of the requested pair', async () => {
    const ethUsdc1 = poolKey(ETH, USDC, 1n);
    const ethUsdc2 = poolKey(ETH, USDC, 2n);
    const usdcUsdt = poolKey(USDC, USDT, 1n);
    [ethUsdc1, ethUsdc2, usdcUsdt].forEach(trackPool);

    expect((await getPoolIdentifiers(ETH, USDC)).sort()).toEqual(
      [ethUsdc1.stringId, ethUsdc2.stringId].sort(),
    );
    expect(await getPoolIdentifiers(USDT, USDC)).toEqual([usdcUsdt.stringId]);
  });

  it('does not depend on the token order', async () => {
    const usdcUsdt = poolKey(USDC, USDT, 1n);
    trackPool(usdcUsdt);

    expect(await getPoolIdentifiers(USDC, USDT)).toEqual([usdcUsdt.stringId]);
    expect(await getPoolIdentifiers(USDT, USDC)).toEqual([usdcUsdt.stringId]);
  });

  it('returns no pools for an unknown pair', async () => {
    trackPool(poolKey(ETH, USDC, 1n));

    expect(await getPoolIdentifiers(WBTC, USDT)).toEqual([]);
    expect(await getPoolIdentifiers(ETH, WBTC)).toEqual([]);
  });

  it('includes pools tracked later without duplicates', async () => {
    const first = poolKey(ETH, USDC, 1n);
    trackPool(first);
    expect(await getPoolIdentifiers(ETH, USDC)).toEqual([first.stringId]);

    const second = poolKey(ETH, USDC, 2n);
    trackPool(second);
    trackPool(first);

    expect((await getPoolIdentifiers(ETH, USDC)).sort()).toEqual(
      [first.stringId, second.stringId].sort(),
    );
  });

  it('adds fallback pools while the pool keys are not synced', async () => {
    const tracked = poolKey(USDC, USDT, 1n);
    trackPool(tracked);
    (ekubo as any).poolKeysSynced = false;

    const ids = await getPoolIdentifiers(USDC, USDT);

    expect(ids).toContain(tracked.stringId);
    expect(ids.length).toBeGreaterThan(1);
    expect(
      ids.every(id => {
        const key = PoolKey.fromStringId(id);
        return key.token0 === USDC && key.token1 === USDT;
      }),
    ).toBe(true);
  });
});
