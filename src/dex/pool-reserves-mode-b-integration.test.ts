import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../dex-helper/index';
import { Network, UNLIMITED_RESERVES } from '../constants';
import { PoolReserves } from '../types';
import {
  expectPoolReserves,
  impliedDirections,
} from '../../tests/utils-pool-reserves';
import { ERC4626 } from './erc4626/erc4626';
import { ERC4626Config } from './erc4626/config';
import { AaveGsm } from './aave-gsm/aave-gsm';
import { AaveGsmConfig } from './aave-gsm/config';
import { OSwap } from './oswap/oswap';
import { OSwapConfig } from './oswap/config';
import { WooFiV2 } from './woo-fi-v2/woo-fi-v2';
import { MiroMigrator } from './miro-migrator/miro-migrator';
import { MiroMigratorConfig } from './miro-migrator/config';
import { AngleTransmuter } from './angle-transmuter/angle-transmuter';
import { AngleTransmuterConfig } from './angle-transmuter/config';
import { AngleStakedStable } from './angle-staked-stable/angle-staked-stable';
import { AngleStakedStableConfig } from './angle-staked-stable/config';
import { Cap } from './cap/cap';
import { CapConfig } from './cap/config';
import { AaveV3 } from './aave-v3/aave-v3';
import { AaveV3Stata } from './aave-v3-stata/aave-v3-stata';
import { AaveV3StataV2 } from './aave-v3-stata-v2/aave-v3-stata-v2';
import { LitePsm } from './lite-psm/lite-psm';

// Enumerated-mode adapters whose reserves come from event / poller state or
// an RPC call. Each case initializes pricing the way a slave instance does,
// then checks the direction set against the dex's `getPricesVolume` guards.

jest.setTimeout(120 * 1000);

const lc = (a: string) => a.toLowerCase();
const dir = (src: string, dest: string) => `${lc(src)}_${lc(dest)}`;

const isNumeric = (v: string) => /^(0|[1-9][0-9]*)$/.test(v);
const isPositive = (v: string) => isNumeric(v) && BigInt(v) > 0n;

async function init<T extends object>(
  network: Network,
  build: (dexHelper: DummyDexHelper) => T,
): Promise<T> {
  const dexHelper = new DummyDexHelper(network);
  const dex = build(dexHelper);
  const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
  const initializePricing = (
    dex as { initializePricing?: (bn: number) => unknown }
  ).initializePricing;
  if (initializePricing) await initializePricing.call(dex, blockNumber);
  return dex;
}

const expectDirections = (pool: PoolReserves, directions: string[]) =>
  expect(impliedDirections(pool.reserves)).toEqual(new Set(directions));

describe('pool reserves: enumerated mode (state-backed dexes)', () => {
  it('LitePsm: gem <-> dai / usds, no dai <-> usds', async () => {
    const dexKey = 'LitePsm';
    const dex = await init(
      Network.MAINNET,
      h => new LitePsm(Network.MAINNET, dexKey, h),
    );
    const reserves = dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(1);

    const dai = '0x6b175474e89094c44da98b954eedeac495271d0f';
    const usds = '0xdc035d45d973e3ec169d2276ddab16f1e407384f';
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    expectDirections(reserves[0], [
      dir(usdc, dai),
      dir(dai, usdc),
      dir(usdc, usds),
      dir(usds, usdc),
    ]);
    expect(isPositive(reserves[0].reserves[dir(usdc, dai)])).toBeTruthy();
    expect(isPositive(reserves[0].reserves[dir(dai, usdc)])).toBeTruthy();
  });

  describe('ERC4626: asset -> vault unlimited, vault -> asset = totalAssets', () => {
    const cases: [string, Network][] = [
      ['sDAI', Network.GNOSIS],
      ['sUSDe', Network.MAINNET],
    ];
    cases.forEach(([dexKey, network]) => {
      it(dexKey, async () => {
        const { vault, asset } = ERC4626Config[dexKey][network];
        const dex = await init(network, h => new ERC4626(network, dexKey, h));
        const reserves = dex.getPoolReserves();
        expectPoolReserves(reserves, dexKey);
        expect(reserves).toHaveLength(1);
        expect(reserves[0].address).toEqual(lc(vault));
        expect(reserves[0].reserves[dir(asset, vault)]).toEqual(
          UNLIMITED_RESERVES,
        );
        const redeem = reserves[0].reserves[dir(vault, asset)];
        // sUSDe may have a cooldown that disables redeem; then the key is absent
        if (redeem !== undefined) expect(isPositive(redeem)).toBeTruthy();
        else expect(dexKey).toEqual('sUSDe');
      });
    });
  });

  it('AaveGsm: gho -> underlying = liquidity, underlying -> gho = remaining cap in GHO', async () => {
    const dexKey = 'AaveGsm';
    const config = AaveGsmConfig[dexKey][Network.MAINNET];
    const dex = await init(
      Network.MAINNET,
      h => new AaveGsm(Network.MAINNET, dexKey, h),
    );
    const reserves = dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);
    expect(reserves.length).toBeGreaterThan(0);

    const expected: Record<string, string> = {
      [lc(config.GSM_USDT)]: lc(config.waEthUSDT),
      [lc(config.GSM_USDC)]: lc(config.waEthUSDC),
    };
    for (const pool of reserves) {
      const underlying = expected[pool.address];
      expect(underlying).toBeDefined();
      expectDirections(pool, [
        dir(config.GHO, underlying),
        dir(underlying, config.GHO),
      ]);
      expect(
        isNumeric(pool.reserves[dir(config.GHO, underlying)]),
      ).toBeTruthy();
      expect(
        isNumeric(pool.reserves[dir(underlying, config.GHO)]),
      ).toBeTruthy();
    }
  });

  it('OSwap: plain token0 / token1 balances per configured pool', async () => {
    const dexKey = 'OSwap';
    const pools = OSwapConfig[dexKey][Network.MAINNET].pools;
    const dex = await init(
      Network.MAINNET,
      h => new OSwap(Network.MAINNET, dexKey, h),
    );
    const reserves = await dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);
    expect(reserves.map(r => r.address).sort()).toEqual(
      pools.map(p => lc(p.address)).sort(),
    );
    for (const pool of pools) {
      const res = reserves.find(r => r.address === lc(pool.address))!;
      expect(Object.keys(res.reserves).sort()).toEqual(
        [lc(pool.token0), lc(pool.token1)].sort(),
      );
      Object.values(res.reserves).forEach(v =>
        expect(isNumeric(v)).toBeTruthy(),
      );
    }
  });

  it('WooFiV2: single pool, plain reserves for every known token', async () => {
    const dexKey = 'WooFiV2';
    const network = Network.ARBITRUM;
    const dex = await init(network, h => new WooFiV2(network, dexKey, h));
    const reserves = await dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(1);
    const keys = Object.keys(reserves[0].reserves);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    keys.forEach(k => expect(k.includes('_')).toBeFalsy());
    Object.values(reserves[0].reserves).forEach(v =>
      expect(isNumeric(v)).toBeTruthy(),
    );
  });

  it('MiroMigrator: psp / sePSP1 -> VLR only, shared VLR balance', async () => {
    const dexKey = 'MiroMigrator';
    const config = MiroMigratorConfig[dexKey][Network.MAINNET];
    const dex = await init(
      Network.MAINNET,
      h => new MiroMigrator(Network.MAINNET, dexKey, h),
    );
    const reserves = dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(1);
    expect(reserves[0].address).toEqual(lc(config.migratorAddress));
    expectDirections(reserves[0], [
      dir(config.pspTokenAddress, config.vlrTokenAddress),
      dir(config.sePsp1TokenAddress, config.vlrTokenAddress),
    ]);
    expect(
      reserves[0].reserves[dir(config.pspTokenAddress, config.vlrTokenAddress)],
    ).toEqual(
      reserves[0].reserves[
        dir(config.sePsp1TokenAddress, config.vlrTokenAddress)
      ],
    );
    expect(
      reserves[0].reserves[dir(config.vlrTokenAddress, config.pspTokenAddress)],
    ).toBeUndefined();
  });

  it('AngleTransmuter: collateral -> stable unlimited, stable -> collateral = balance', async () => {
    const dexKey = 'AngleTransmuter';
    const params = AngleTransmuterConfig[dexKey][Network.MAINNET];
    const dex = await init(
      Network.MAINNET,
      h => new AngleTransmuter(Network.MAINNET, dexKey, h),
    );
    const reserves = await dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);

    const transmuters = Object.values(params).map(p => lc(p!.transmuter));
    expect(reserves.map(r => r.address).sort()).toEqual(transmuters.sort());
    for (const fiat of Object.values(params)) {
      const pool = reserves.find(r => r.address === lc(fiat!.transmuter))!;
      const stable = lc(fiat!.stablecoin.address);
      const keys = Object.keys(pool.reserves);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const key of keys) {
        const [src, dest] = key.split('_');
        if (dest === stable)
          expect(pool.reserves[key]).toEqual(UNLIMITED_RESERVES);
        else {
          expect(src).toEqual(stable);
          expect(isNumeric(pool.reserves[key])).toBeTruthy();
        }
      }
    }
  });

  describe('AngleStakedStable: ag -> stake unlimited, stake -> ag = totalAssets', () => {
    ['AngleStakedStableUSD', 'AngleStakedStableEUR'].forEach(dexKey => {
      it(dexKey, async () => {
        const { agToken, stakeToken } =
          AngleStakedStableConfig[dexKey][Network.MAINNET];
        const dex = await init(
          Network.MAINNET,
          h => new AngleStakedStable(Network.MAINNET, dexKey, h),
        );
        const reserves = dex.getPoolReserves();
        expectPoolReserves(reserves, dexKey);
        expect(reserves).toHaveLength(1);
        expect(reserves[0].address).toEqual(lc(stakeToken));
        expectDirections(reserves[0], [
          dir(agToken, stakeToken),
          dir(stakeToken, agToken),
        ]);
        expect(reserves[0].reserves[dir(agToken, stakeToken)]).toEqual(
          UNLIMITED_RESERVES,
        );
        expect(
          isPositive(reserves[0].reserves[dir(stakeToken, agToken)]),
        ).toBeTruthy();
      });
    });
  });

  it('Cap: asset -> vault unlimited, vault -> asset = asset supply, per (vault, asset)', async () => {
    const dexKey = 'Cap';
    const configs = CapConfig[dexKey][Network.MAINNET];
    const dex = await init(
      Network.MAINNET,
      h => new Cap(Network.MAINNET, dexKey, h),
    );
    const reserves = dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);

    const expected = Object.values(configs).flatMap(c =>
      Object.values(c.assets).map(
        a => `${lc(c.vault.address)}_${lc(a.address)}`,
      ),
    );
    expect(reserves.map(r => r.id).sort()).toEqual(expected.sort());
    for (const pool of reserves) {
      const [vault, asset] = pool.id.split('_');
      expect(pool.address).toEqual(vault);
      expectDirections(pool, [dir(asset, vault), dir(vault, asset)]);
      expect(pool.reserves[dir(asset, vault)]).toEqual(UNLIMITED_RESERVES);
      expect(isNumeric(pool.reserves[dir(vault, asset)])).toBeTruthy();
    }
  });

  it('AaveV3: one plain unlimited pool per reserve', async () => {
    const dexKey = 'AaveV3';
    const dex = await init(
      Network.MAINNET,
      h => new AaveV3(Network.MAINNET, dexKey, h),
    );
    const reserves = dex.getPoolReserves();
    expectPoolReserves(reserves, dexKey);
    expect(reserves.length).toBeGreaterThan(5);
    for (const pool of reserves) {
      const keys = Object.keys(pool.reserves);
      expect(keys).toHaveLength(2);
      expect(keys).toContain(pool.address);
      Object.values(pool.reserves).forEach(v =>
        expect(v).toEqual(UNLIMITED_RESERVES),
      );
    }
  });

  describe('AaveV3 Stata: underlying / aToken <-> stata, no underlying <-> aToken', () => {
    const check = (reserves: PoolReserves[], dexKey: string) => {
      expectPoolReserves(reserves, dexKey);
      expect(reserves.length).toBeGreaterThan(0);
      for (const pool of reserves) {
        const stata = pool.address;
        const keys = Object.keys(pool.reserves);
        expect(keys).toHaveLength(4);
        const others = new Set<string>();
        for (const key of keys) {
          const [src, dest] = key.split('_');
          expect(src === stata || dest === stata).toBeTruthy();
          others.add(src === stata ? dest : src);
          expect(pool.reserves[key]).toEqual(UNLIMITED_RESERVES);
        }
        expect(others.size).toEqual(2);
        const [a, b] = [...others];
        expect(pool.reserves[dir(a, b)]).toBeUndefined();
        expect(pool.reserves[dir(b, a)]).toBeUndefined();
      }
    };

    it('AaveV3Stata (Polygon)', async () => {
      const network = Network.POLYGON;
      const dex = await init(
        network,
        h => new AaveV3Stata(network, 'AaveV3Stata', h),
      );
      check(dex.getPoolReserves(), 'AaveV3Stata');
    });

    it('AaveV3StataV2 (Mainnet)', async () => {
      const network = Network.MAINNET;
      const dex = await init(
        network,
        h => new AaveV3StataV2(network, 'AaveV3StataV2', h),
      );
      check(dex.getPoolReserves(), 'AaveV3StataV2');
    });
  });
});
