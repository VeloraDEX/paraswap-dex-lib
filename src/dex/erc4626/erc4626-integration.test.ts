/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { ERC4626 } from './erc4626';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

const networks = [
  { name: 'Mainnet', network: Network.MAINNET },
  { name: 'Optimism', network: Network.OPTIMISM },
  { name: 'Arbitrum', network: Network.ARBITRUM },
  { name: 'Base', network: Network.BASE },
  { name: 'Polygon', network: Network.POLYGON },
];

describe('WUSDM', function () {
  const dexKey = 'wUSDM';
  const wUSDMSymbol = 'wUSDM';
  const USDMSymbol = 'USDM';

  networks.forEach(({ name, network }) => {
    describe(`${name}`, () => {
      const wUSDMToken = Tokens[network][wUSDMSymbol];
      const USDMToken = Tokens[network][USDMSymbol];
      const amounts = [0n, BI_POWS[18], 2000000000000000000n];
      let dexHelper: DummyDexHelper;
      let blocknumber: number;
      let wusdm: ERC4626;

      beforeAll(async () => {
        dexHelper = new DummyDexHelper(network);
        blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
        wusdm = new ERC4626(network, dexKey, dexHelper);
        if (wusdm.initializePricing) {
          await wusdm.initializePricing(blocknumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume USDM -> wUSDM SELL', async function () {
        const pools = await wusdm.getPoolIdentifiers(
          USDMToken,
          wUSDMToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${USDMToken} <> ${wUSDMSymbol} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await wusdm.getPricesVolume(
          USDMToken,
          wUSDMToken,
          amounts,
          SwapSide.SELL,
          blocknumber,
          pools,
        );
        console.log(`${USDMToken} <> ${wUSDMSymbol} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume wUSDM -> USDM SELL', async function () {
        const pools = await wusdm.getPoolIdentifiers(
          wUSDMToken,
          USDMToken,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${wUSDMSymbol} <> ${USDMToken} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await wusdm.getPricesVolume(
          wUSDMToken,
          USDMToken,
          amounts,
          SwapSide.SELL,
          blocknumber,
          pools,
        );
        console.log(`${wUSDMSymbol} <> ${USDMToken} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume USDM -> wUSDM BUY', async function () {
        const pools = await wusdm.getPoolIdentifiers(
          USDMToken,
          wUSDMToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${USDMToken} <> ${wUSDMSymbol} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await wusdm.getPricesVolume(
          USDMToken,
          wUSDMToken,
          amounts,
          SwapSide.BUY,
          blocknumber,
          pools,
        );
        console.log(`${USDMToken} <> ${wUSDMSymbol} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume wUSDM -> USDM BUY', async function () {
        const pools = await wusdm.getPoolIdentifiers(
          wUSDMToken,
          USDMToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${wUSDMSymbol} <> ${USDMToken} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await wusdm.getPricesVolume(
          wUSDMToken,
          USDMToken,
          amounts,
          SwapSide.BUY,
          blocknumber,
          pools,
        );
        console.log(`${wUSDMSymbol} <> ${USDMToken} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
      });

      it('USDM getTopPoolsForToken', async function () {
        const poolLiquidity = await wusdm.getTopPoolsForToken(
          USDMToken.address,
          10,
        );
        console.log(`${USDMToken} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, USDMToken.address, dexKey);
      });

      it('wUSDM getTopPoolsForToken', async function () {
        const poolLiquidity = await wusdm.getTopPoolsForToken(
          wUSDMToken.address,
          10,
        );
        console.log(`${wUSDMSymbol} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, wUSDMToken.address, dexKey);
      });
    });
  });
});

describe('sUSDe', function () {
  const dexKey = 'sUSDe';
  const network = Network.MAINNET;
  const sUSDeSymbol = 'SUSDE';
  const USDeSymbol = 'USDE';

  let dexHelper: DummyDexHelper;
  let sUSDe: ERC4626;

  const sUSDeToken = Tokens[network][sUSDeSymbol];
  const USDeToken = Tokens[network][USDeSymbol];

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    sUSDe = new ERC4626(network, dexKey, dexHelper);
    await sUSDe.updatePoolState();
    await sUSDe.updatePoolState();
    await sUSDe.updatePoolState();
  });

  it('USDe getTopPoolsForToken', async function () {
    const poolLiquidity = await sUSDe.getTopPoolsForToken(
      USDeToken.address,
      10,
    );
    console.log(`${USDeToken} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, USDeToken.address, dexKey);
  });

  it('sUSDe getTopPoolsForToken', async function () {
    const poolLiquidity = await sUSDe.getTopPoolsForToken(
      sUSDeToken.address,
      10,
    );
    console.log(`${sUSDeSymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, sUSDeToken.address, dexKey);
  });
});
