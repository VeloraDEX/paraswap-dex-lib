import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../dex-helper/index';
import { ETHER_ADDRESS, Network, UNLIMITED_RESERVES } from '../constants';
import { PoolReserves } from '../types';
import {
  expectPoolReserves,
  impliedDirections,
} from '../../tests/utils-pool-reserves';
import { Weth } from './weth/weth';
import { WstETH } from './wsteth/wsteth';
import { Spark } from './spark/spark';
import { SparkPsm } from './spark/spark-psm';
import { UsdcTransmuter } from './usdc-transmuter/usdc-transmuter';
import { PolygonMigrator } from './polygon-migrator/polygon-migrator';
import { Swell } from './swell/swell';
import { SkyConverter } from './sky-converter/sky-converter';
import { AaveV3PtRollOver } from './aave-v3-pt-roll-over/aave-v3-pt-roll-over';
import { StkGHO } from './stkgho/stkgho';
import { UsualBond } from './usual/usual-bond';
import { UsdcUsualUSDC } from './usual/usdc-usual-usdc';
import { UsualUSDCUsd0 } from './usual/usual-usdc-usd0';
import { UsualMWrappedM } from './usual/usual-m-wrapped-m';
import { UsualMUsd0 } from './usual/usual-m-usd0';
import { MWrappedM } from './usual/m-wrapped-m';
import { WrappedMM } from './usual/wrapped-m-m';
import { UsualPP } from './usual-pp/usual-pp';
import { FxProtocolRusd } from './fx-protocol-rusd/fx-protocol-rusd';
import { dETH } from './deth/dETH';

// Enumerated-mode adapters whose pool set and directions come from config
// alone, so they run without RPC. Expected direction sets are written
// explicitly from each dex's `getPricesVolume` guards.

const pairs = (...tokens: string[]): string[] => {
  const out: string[] = [];
  for (const a of tokens)
    for (const b of tokens) if (a !== b) out.push(`${a}_${b}`);
  return out;
};

const expectSinglePool = (
  reserves: PoolReserves[],
  dexKey: string,
  address: string,
  directions: string[],
  unlimited = true,
) => {
  expectPoolReserves(reserves, dexKey);
  expect(reserves).toHaveLength(1);
  expect(reserves[0].address).toEqual(address.toLowerCase());
  expect(impliedDirections(reserves[0].reserves)).toEqual(new Set(directions));
  if (unlimited) {
    Object.values(reserves[0].reserves).forEach(v =>
      expect(v).toEqual(UNLIMITED_RESERVES),
    );
  }
};

describe('pool reserves: enumerated mode (config-only dexes)', () => {
  const mainnet = new DummyDexHelper(Network.MAINNET);

  it('Weth', async () => {
    const weth = new Weth(Network.MAINNET, 'Weth', mainnet);
    const wrapped = mainnet.config.data.wrappedNativeTokenAddress.toLowerCase();
    expectSinglePool(
      await weth.getPoolReserves(),
      'Weth',
      wrapped,
      pairs(ETHER_ADDRESS, wrapped),
    );
  });

  it('wstETH', async () => {
    const dex = new WstETH(Network.MAINNET, 'wstETH', mainnet);
    const wstETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
    const stETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
    expectSinglePool(
      await dex.getPoolReserves(),
      'wstETH',
      wstETH,
      pairs(stETH, wstETH),
    );
  });

  it('Spark (sDAI)', async () => {
    const dex = new Spark(Network.MAINNET, 'Spark', mainnet);
    const sdai = '0x83f20f44975d03b1b09e64809b757c47f942beea';
    const dai = '0x6b175474e89094c44da98b954eedeac495271d0f';
    expectSinglePool(
      await dex.getPoolReserves(),
      'Spark',
      sdai,
      pairs(dai, sdai),
    );
  });

  it('SparkPsm', async () => {
    const arbitrum = new DummyDexHelper(Network.ARBITRUM);
    const dex = new SparkPsm(Network.ARBITRUM, 'SparkPsm', arbitrum);
    const susds = '0xddb46999f8891663a8f2828d25298f70416d7610';
    const usds = '0x6491c05a82219b8d1479057361ff1654749b876b';
    const usdc = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
    const psm = '0x2b05f8e1cacc6974fd79a673a341fe1f58d27266';
    expectSinglePool(
      await dex.getPoolReserves(),
      'SparkPsm',
      psm,
      pairs(usds, susds, usdc),
    );
  });

  it('UsdcTransmuter', async () => {
    const gnosis = new DummyDexHelper(Network.GNOSIS);
    const dex = new UsdcTransmuter(Network.GNOSIS, 'UsdcTransmuter', gnosis);
    const usdc = '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83';
    const usdce = '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0';
    expectSinglePool(
      await dex.getPoolReserves(),
      'UsdcTransmuter',
      '0x0392a2f5ac47388945d8c84212469f545fae52b2',
      pairs(usdc, usdce),
    );
  });

  it('PolygonMigrator', async () => {
    const dex = new PolygonMigrator(
      Network.MAINNET,
      'PolygonMigrator',
      mainnet,
    );
    const pol = '0x455e53cbb86018ac2b8092fdcd39d8444affc3f6';
    const matic = '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0';
    expectSinglePool(
      await dex.getPoolReserves(),
      'PolygonMigrator',
      '0x29e7df7b6a1b2b07b731457f499e1696c60e2c4e',
      pairs(matic, pol),
    );
  });

  it('Swell: one-way ETH/WETH -> share, no reverse', async () => {
    const dex = new Swell(Network.MAINNET, 'Swell', mainnet);
    const weth = mainnet.config.data.wrappedNativeTokenAddress.toLowerCase();
    const swETH = '0xf951e335afb289353dc249e82926178eac7ded78';
    const rswETH = '0xfae103dc9cf190ed75350761e95403b7b8afa6c0';

    const reserves = await dex.getPoolReserves();
    expectPoolReserves(reserves, 'Swell');
    expect(reserves.map(r => r.address).sort()).toEqual([swETH, rswETH].sort());
    for (const share of [swETH, rswETH]) {
      const pool = reserves.find(r => r.address === share)!;
      expect(impliedDirections(pool.reserves)).toEqual(
        new Set([`${ETHER_ADDRESS}_${share}`, `${weth}_${share}`]),
      );
      expect(pool.reserves[`${share}_${ETHER_ADDRESS}`]).toBeUndefined();
    }
  });

  it('DaiUsds: both directions', async () => {
    const dex = new SkyConverter(Network.MAINNET, 'DaiUsds', mainnet);
    const dai = '0x6b175474e89094c44da98b954eedeac495271d0f';
    const usds = '0xdc035d45d973e3ec169d2276ddab16f1e407384f';
    expectSinglePool(
      await dex.getPoolReserves(),
      'DaiUsds',
      '0x3225737a9bbb6473cb4a45b7244aca2befdb276a',
      [`${dai}_${usds}`, `${usds}_${dai}`],
    );
  });

  it('MkrSky: one-way, no SKY -> MKR', async () => {
    const dex = new SkyConverter(Network.MAINNET, 'MkrSky', mainnet);
    const mkr = '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2';
    const sky = '0x56072c95faa701256059aa122697b133aded9279';
    const reserves = await dex.getPoolReserves();
    expectSinglePool(
      reserves,
      'MkrSky',
      '0xa1ea1ba18e88c381c724a75f23a130420c403f9a',
      [`${mkr}_${sky}`],
    );
    expect(reserves[0].reserves[`${sky}_${mkr}`]).toBeUndefined();
  });

  it('AaveV3Pendle: old PT -> new PT only', async () => {
    const dex = new AaveV3PtRollOver(Network.MAINNET, 'AaveV3Pendle', mainnet);
    const oldPt = '0x3b3fb9c57858ef816833dc91565efcd85d96f634';
    const newPt = '0x9f56094c450763769ba0ea9fe2876070c0fd5f77';
    const reserves = await dex.getPoolReserves();
    expectSinglePool(
      reserves,
      'AaveV3Pendle',
      '0x4339ffe2b7592dc783ed13cce310531ab366deac',
      [`${oldPt}_${newPt}`],
    );
    expect(reserves[0].reserves[`${newPt}_${oldPt}`]).toBeUndefined();
  });

  it('StkGHO: GHO -> stkGHO only', async () => {
    const dex = new StkGHO(Network.MAINNET, 'StkGHO', mainnet);
    const stkGho = '0x1a88df1cfe15af22b3c4c783d4e6f7f9e0c1885d';
    const gho = '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f';
    const reserves = await dex.getPoolReserves();
    expectSinglePool(reserves, 'StkGHO', stkGho, [`${gho}_${stkGho}`]);
    expect(reserves[0].reserves[`${stkGho}_${gho}`]).toBeUndefined();
  });

  describe('Usual family: one-way fromToken -> toToken', () => {
    const usd0 = '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5';
    const usd0pp = '0x35d8949372d46b7a3d5a56006ae77b215fc69bc0';
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const usualUsdc = '0xb672b3976baa3952bfb2ece8eefb784f8dab1424';
    const wrappedM = '0x437cc33344a0b27a429f795ff6b469c72698b291';
    const usualM = '0x4cbc25559dbbd1272ec5b64c7b5f48a2405e6470';
    const m = '0x866a2bf4e572cbcf37d5071a7a58503bfb36be1b';

    const cases: [string, any, string, string][] = [
      ['UsualBond', UsualBond, usd0, usd0pp],
      ['UsdcUsualUSDC', UsdcUsualUSDC, usdc, usualUsdc],
      ['UsualUSDCUsd0', UsualUSDCUsd0, usualUsdc, usd0],
      ['UsualMWrappedM', UsualMWrappedM, wrappedM, usualM],
      ['UsualMUsd0', UsualMUsd0, usualM, usd0],
      ['MWrappedM', MWrappedM, m, wrappedM],
      ['WrappedMM', WrappedMM, wrappedM, m],
    ];

    cases.forEach(([dexKey, Dex, from, to]) => {
      it(dexKey, async () => {
        const dex = new Dex(Network.MAINNET, dexKey, mainnet);
        const reserves = await dex.getPoolReserves();
        expectSinglePool(reserves, dexKey, to, [`${from}_${to}`]);
        expect(reserves[0].reserves[`${to}_${from}`]).toBeUndefined();
      });
    });
  });

  it('UsualPP: USD0++ -> USD0 only', async () => {
    const dex = new UsualPP(Network.MAINNET, 'UsualPP', mainnet);
    const usd0 = '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5';
    const usd0pp = '0x35d8949372d46b7a3d5a56006ae77b215fc69bc0';
    const reserves = await dex.getPoolReserves();
    expectSinglePool(reserves, 'UsualPP', usd0pp, [`${usd0pp}_${usd0}`]);
    expect(reserves[0].reserves[`${usd0}_${usd0pp}`]).toBeUndefined();
  });

  it('FxProtocolRusd: weETH <-> rUSD', async () => {
    const dex = new FxProtocolRusd(Network.MAINNET, 'FxProtocolRusd', mainnet);
    const rusd = '0x65d72aa8da931f047169112fcf34f52dbaae7d18';
    const weeth = '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee';
    expectSinglePool(
      await dex.getPoolReserves(),
      'FxProtocolRusd',
      rusd,
      pairs(rusd, weeth),
    );
  });

  describe('dETH: ETH/WETH <-> dETH, no ETH <-> WETH', () => {
    const deth = '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742';
    const cases: [string, Network][] = [
      ['dETH', Network.MAINNET],
      ['dBNB', Network.BSC],
      ['dPOL', Network.POLYGON],
    ];
    cases.forEach(([dexKey, network]) => {
      it(dexKey, async () => {
        const helper = new DummyDexHelper(network);
        const weth = helper.config.data.wrappedNativeTokenAddress.toLowerCase();
        const dex = new dETH(network, dexKey, helper);
        const reserves = await dex.getPoolReserves();
        expectSinglePool(reserves, dexKey, deth, [
          `${ETHER_ADDRESS}_${deth}`,
          `${weth}_${deth}`,
          `${deth}_${ETHER_ADDRESS}`,
          `${deth}_${weth}`,
        ]);
        expect(
          reserves[0].reserves[`${ETHER_ADDRESS}_${weth}`],
        ).toBeUndefined();
      });
    });
  });
});
