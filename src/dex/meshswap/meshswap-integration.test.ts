import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Meshswap } from './meshswap';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';

/*
  README
  ======

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-integration.test.ts`

  (This comment should be removed from the final implementation)
*/

const network = Network.POLYGON;

const amounts = [0n, BI_POWS[18], 2000000000000000000n];

const dexKey = 'Meshswap';

const WMATIC = {
  address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  decimals: 18,
};

const MESH = {
  address: '0x82362Ec182Db3Cf7829014Bc61E9BE8a2E82868a',
  decimals: 18,
};

describe('Meshswap', function () {
  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.provider.getBlockNumber();
    const meshswap = new Meshswap(network, dexKey, dexHelper);

    const pools = await meshswap.getPoolIdentifiers(
      WMATIC,
      MESH,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`WMATIC <> MESH Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await meshswap.getPricesVolume(
      WMATIC,
      MESH,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`WMATIC <> MESH Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.provider.getBlockNumber();
    const meshswap = new Meshswap(network, dexKey, dexHelper);

    const pools = await meshswap.getPoolIdentifiers(
      WMATIC,
      MESH,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`WMATIC <> MESH Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await meshswap.getPricesVolume(
      WMATIC,
      MESH,
      amounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`WMATIC <> MESH Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('getTopPoolsForToken', async function () {
    const dexHelper = new DummyDexHelper(network);
    const meshswap = new Meshswap(network, dexKey, dexHelper);

    const poolLiquidity = await meshswap.getTopPoolsForToken(
      WMATIC.address,
      10,
    );
    console.log(`WMATIC Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, WMATIC.address, dexKey);
  });
});
