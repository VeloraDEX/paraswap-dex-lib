import dotenv from 'dotenv';
dotenv.config();

process.env.API_KEY_LIQUORICE = process.env.API_KEY_LIQUORICE || 'test-key';

import { DummyDexHelper } from '../../dex-helper';
import { ETHER_ADDRESS, Network, SwapSide } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { Liquorice } from './liquorice';
import {
  LIQUORICE_PRICES_CACHE_KEY,
  LIQUORICE_TOKENS_CACHE_KEY,
} from './constants';

describe('Liquorice Integration (unit cache based)', () => {
  const network = Network.MAINNET;
  const dexKey = 'Liquorice';
  const dexHelper = new DummyDexHelper(network);
  const liquorice = new Liquorice(network, dexKey, dexHelper);
  const tokens = Tokens[network];

  const weth = tokens.WETH;
  const usdc = tokens.USDC;
  const usdt = tokens.USDT;
  const eth = { address: ETHER_ADDRESS, decimals: 18 };

  const lower = (a: string) => a.toLowerCase();
  const wethUsdc = `${lower(weth.address)}_${lower(usdc.address)}`;
  const poolId = `liquorice_${wethUsdc}`;

  beforeAll(async () => {
    const book = {
      // WETH -> USDC, two makers
      [wethUsdc]: {
        curves: [
          {
            minAmount: '1',
            levels: [
              ['3200', '1'],
              ['3195', '5'],
              ['3190', '10'],
            ],
          },
          { minAmount: '0.1', levels: [['3210', '1.5']] },
        ],
      },
      // USDT -> WETH
      [`${lower(usdt.address)}_${lower(weth.address)}`]: {
        curves: [{ minAmount: '1000', levels: [['0.0003125', '64000']] }],
      },
    };
    await dexHelper.cache.setex(
      dexKey,
      network,
      LIQUORICE_PRICES_CACHE_KEY,
      60,
      JSON.stringify(book),
    );

    const tokenMap = Object.fromEntries(
      [weth, usdc, usdt].map(t => [
        lower(t.address),
        { address: lower(t.address), symbol: t.symbol, decimals: t.decimals },
      ]),
    );
    await dexHelper.cache.setex(
      dexKey,
      network,
      LIQUORICE_TOKENS_CACHE_KEY,
      60,
      JSON.stringify(tokenMap),
    );
  });

  it('getPoolIdentifiers SELL', async () => {
    expect(
      await liquorice.getPoolIdentifiers(weth, usdc, SwapSide.SELL, 0),
    ).toEqual([poolId]);
  });

  it('getPoolIdentifiers maps ETH to WETH', async () => {
    expect(
      await liquorice.getPoolIdentifiers(eth, usdc, SwapSide.SELL, 0),
    ).toEqual([poolId]);
  });

  it('getPoolIdentifiers is empty for BUY and unknown pairs', async () => {
    expect(
      await liquorice.getPoolIdentifiers(weth, usdc, SwapSide.BUY, 0),
    ).toEqual([]);
    // only USDT -> WETH exists, not the reverse
    expect(
      await liquorice.getPoolIdentifiers(weth, usdt, SwapSide.SELL, 0),
    ).toEqual([]);
  });

  it('getPricesVolume SELL takes the best single maker per amount', async () => {
    const unit = BI_POWS[weth.decimals];
    const amounts = [
      0n,
      unit / 20n, // 0.05: below every maker minimum
      unit / 2n, // 0.5: only the 0.1-1.5 maker
      unit, // 1: both; the small maker pays 3210
      2n * unit, // 2: only the deep maker (3200 + 3195)
      16n * unit, // 16: deep maker's full depth
      17n * unit, // 17: beyond any maker
    ];

    const prices = await liquorice.getPricesVolume(
      weth,
      usdc,
      amounts,
      SwapSide.SELL,
      0,
    );

    expect(prices).not.toBeNull();
    const [pool] = prices!;
    const usdcUnit = BI_POWS[usdc.decimals];
    expect(pool.prices).toEqual([
      0n,
      0n,
      1605n * usdcUnit,
      3210n * usdcUnit,
      6395n * usdcUnit,
      (3200n + 5n * 3195n + 10n * 3190n) * usdcUnit,
      0n,
    ]);
    expect(pool.unit).toBe(3210n * usdcUnit);
    expect(pool.poolIdentifiers).toEqual([poolId]);
    expect(pool.exchange).toBe(dexKey);
    expect(pool.data).toEqual({});
  });

  it('getPricesVolume scales the unit when one token is below the minimum', async () => {
    const prices = await liquorice.getPricesVolume(
      usdt,
      weth,
      [2000n * BI_POWS[usdt.decimals]],
      SwapSide.SELL,
      0,
    );

    expect(prices![0].prices).toEqual([625n * BI_POWS[weth.decimals - 3]]);
    // 1 USDT is below the 1000 USDT minimum: unit comes from 1000 / 1000
    expect(prices![0].unit).toBe(3125n * BI_POWS[weth.decimals - 7]);
  });

  it('getPricesVolume returns null for BUY, unknown pairs, excluded pools and unquotable amounts', async () => {
    const one = [BI_POWS[weth.decimals]];
    expect(
      await liquorice.getPricesVolume(weth, usdc, one, SwapSide.BUY, 0),
    ).toBeNull();
    expect(
      await liquorice.getPricesVolume(weth, usdt, one, SwapSide.SELL, 0),
    ).toBeNull();
    expect(
      await liquorice.getPricesVolume(weth, usdc, one, SwapSide.SELL, 0, [
        'liquorice_other',
      ]),
    ).toBeNull();
    expect(
      await liquorice.getPricesVolume(
        weth,
        usdc,
        [100n * BI_POWS[weth.decimals]],
        SwapSide.SELL,
        0,
      ),
    ).toBeNull();
  });

  it('getTopPoolsForToken reports the deepest maker per connector', async () => {
    dexHelper.getUsdTokenAmounts = async tokenAmounts =>
      tokenAmounts.map(([token, amount]) => {
        const isWeth = token === lower(weth.address);
        const decimals = isWeth ? weth.decimals : 6;
        return (Number(amount!) / 10 ** decimals) * (isWeth ? 3200 : 1);
      });

    const pools = await liquorice.getTopPoolsForToken(weth.address, 10);

    // Sorted by liquidity
    expect(pools.map(p => p.connectorTokens[0].address)).toEqual([
      lower(usdt.address),
      lower(usdc.address),
    ]);
    // USDT -> WETH: 64000 USDT buys 20 WETH, so the WETH side is $64,000
    expect(pools[0].liquidityUSD).toBe(20 * 3200);
    expect(pools[0].connectorTokens[0].liquidityUSD).toBe(64000);
    // WETH -> USDC: the deep maker takes 16 WETH = $51,200
    expect(pools[1].liquidityUSD).toBe(16 * 3200);
    expect(pools[1].exchange).toBe(dexKey);
  });
});
