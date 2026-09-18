import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../dex-helper/index';
import { Network, SwapSide } from '../constants';
import { Tokens } from '../../tests/constants-e2e';
import { expectPoolReserves } from '../../tests/utils-pool-reserves';
import { EkuboV3 } from './ekubo-v3/ekubo-v3';
import { CORE_ADDRESS } from './ekubo-v3/config';
import { MaverickV2 } from './maverick-v2/maverick-v2';
import { Algebra } from './algebra/algebra';
import { AlgebraIntegral } from './algebra-integral/algebra-integral';

// Storage-mode AMMs against live RPC: each dex publishes its pools through
// its writer into the dummy cache, the stored descriptors are fed back to
// `getPoolReserves`, and the results are checked for shape and content.

jest.setTimeout(180 * 1000);

const lc = (a: string) => a.toLowerCase();
const isNumeric = (v: string) => /^(0|[1-9][0-9]*)$/.test(v);
const isPositive = (v: string) => isNumeric(v) && BigInt(v) > 0n;

async function publish(dex: any, dexHelper: DummyDexHelper) {
  await dex.poolsWriter.flush();
  const stored = await dexHelper.cache.hgetAll(dex.getPoolsStorage().key);
  return { fields: Object.keys(stored), descriptors: Object.values(stored) };
}

describe('pool reserves: storage mode (EkuboV3, MaverickV2, Algebra, AlgebraIntegral)', () => {
  it('EkuboV3: every published pool with state reports its TVL at the core address', async () => {
    const network = Network.MAINNET;
    const dexKey = 'EkuboV3';
    const dexHelper = new DummyDexHelper(network);
    const dex = new EkuboV3(network, dexKey, dexHelper);
    await dex.initializePricing(
      await dexHelper.web3Provider.eth.getBlockNumber(),
    );
    dex.releaseResources();

    const { fields, descriptors } = await publish(dex, dexHelper);
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach(f => expect(f.startsWith('ekubov3_')).toBeTruthy());

    const reserves = dex.getPoolReserves(descriptors);
    expectPoolReserves(reserves, dexKey);
    expect(reserves.length).toBeGreaterThan(0);
    const ids = new Set(fields);
    for (const pool of reserves) {
      expect(ids.has(pool.id)).toBeTruthy();
      expect(pool.address).toEqual(lc(CORE_ADDRESS));
      const { t0, t1 } = JSON.parse(descriptors[fields.indexOf(pool.id)]) as {
        t0: string;
        t1: string;
      };
      expect(Object.keys(pool.reserves).sort()).toEqual([t0, t1].sort());
    }
  });

  it('MaverickV2: published pools serve reserves from state', async () => {
    const network = Network.BASE;
    const dexKey = 'MaverickV2';
    const dexHelper = new DummyDexHelper(network);
    const dex = new MaverickV2(network, dexKey, dexHelper);
    await dex.initializePricing(
      await dexHelper.web3Provider.eth.getBlockNumber(),
    );
    dex.releaseResources();

    const { fields, descriptors } = await publish(dex, dexHelper);
    expect(fields.length).toBeGreaterThan(0);

    const reserves = await dex.getPoolReserves(descriptors);
    expectPoolReserves(reserves, dexKey);
    expect(reserves.length).toBeGreaterThan(0);
    expect(new Set(reserves.map(r => r.id)).size).toEqual(reserves.length);
    reserves.forEach(pool => {
      expect(fields).toContain(pool.id);
      Object.values(pool.reserves).forEach(v =>
        expect(isNumeric(v)).toBeTruthy(),
      );
    });
  });

  it('QuickSwapV3 (Algebra): a priced pool is published and reports both balances', async () => {
    const network = Network.POLYGON;
    const dexKey = 'QuickSwapV3';
    const dexHelper = new DummyDexHelper(network);
    const dex = new Algebra(network, dexKey, dexHelper);
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    await dex.initializePricing(blockNumber);
    dex.releaseResources();

    const { WMATIC, DAI } = Tokens[network];
    await dex.getPricesVolume(
      WMATIC,
      DAI,
      [0n, 10n ** 18n],
      SwapSide.SELL,
      blockNumber,
    );

    const { fields, descriptors } = await publish(dex, dexHelper);
    expect(fields).toHaveLength(1);

    const reserves = await dex.getPoolReserves(descriptors);
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toHaveLength(1);
    expect(reserves[0].id).toEqual(fields[0]);
    expect(Object.keys(reserves[0].reserves).sort()).toEqual(
      [lc(WMATIC.address), lc(DAI.address)].sort(),
    );
    Object.values(reserves[0].reserves).forEach(v =>
      expect(isPositive(v)).toBeTruthy(),
    );
  });

  it('QuickSwapV4 (AlgebraIntegral): factory pools are published and unpriced ones served over RPC', async () => {
    const network = Network.BASE;
    const dexKey = 'QuickSwapV4';
    const dexHelper = new DummyDexHelper(network);
    const dex = new AlgebraIntegral(network, dexKey, dexHelper);
    await dex.initializePricing(
      await dexHelper.web3Provider.eth.getBlockNumber(),
    );
    dex.releaseResources();

    const { fields, descriptors } = await publish(dex, dexHelper);
    expect(fields.length).toBeGreaterThan(0);

    const sample = descriptors.slice(0, 20);
    const reserves = await dex.getPoolReserves(sample);
    expectPoolReserves(reserves, dexKey);
    expect(reserves.length).toBeGreaterThan(0);
    expect(reserves.length).toBeLessThanOrEqual(sample.length);
    reserves.forEach(pool => {
      expect(fields).toContain(pool.id);
      expect(pool.address).toEqual(pool.id);
      Object.values(pool.reserves).forEach(v =>
        expect(isNumeric(v)).toBeTruthy(),
      );
    });
  });
});
