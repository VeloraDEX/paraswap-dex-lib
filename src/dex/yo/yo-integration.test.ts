/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Yo } from './yo';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

const networks = [{ name: 'Base', network: Network.BASE }];

describe('yoETH', function () {
  const dexKey = 'yoETH';
  const yoETHSymbol = 'yoETH';
  const WETHSymbol = 'WETH';

  networks.forEach(({ name, network }) => {
    describe(`${name}`, () => {
      const yoETHToken = Tokens[network][yoETHSymbol];
      const ETHToken = Tokens[network][WETHSymbol];
      const amounts = [0n, BI_POWS[18], 2000000000000000000n];
      let dexHelper: DummyDexHelper;
      let blocknumber: number;
      let yoETH: Yo;

      beforeAll(async () => {
        dexHelper = new DummyDexHelper(network);
        blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
        yoETH = new Yo(network, dexKey, dexHelper);
        if (yoETH.initializePricing) {
          await yoETH.initializePricing(blocknumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume ETH -> yoETH SELL', async function () {
        const pools = await yoETH.getPoolIdentifiers(
          ETHToken,
          yoETHToken,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${ETHToken} <> ${yoETHSymbol} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoETH.getPricesVolume(
          ETHToken,
          yoETHToken,
          amounts,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${ETHToken} <> ${yoETHSymbol} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume yoETH -> ETH SELL', async function () {
        const pools = await yoETH.getPoolIdentifiers(
          yoETHToken,
          ETHToken,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${yoETHSymbol} <> ${ETHToken} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoETH.getPricesVolume(
          yoETHToken,
          ETHToken,
          amounts,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${yoETHSymbol} <> ${ETHToken} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume ETH -> yoETH BUY', async function () {
        const pools = await yoETH.getPoolIdentifiers(
          ETHToken,
          yoETHToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${ETHToken} <> ${yoETHSymbol} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoETH.getPricesVolume(
          ETHToken,
          yoETHToken,
          amounts,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${ETHToken} <> ${yoETHSymbol} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume yoETH -> ETH BUY', async function () {
        const pools = await yoETH.getPoolIdentifiers(
          yoETHToken,
          ETHToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${yoETHSymbol} <> ${ETHToken} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoETH.getPricesVolume(
          yoETHToken,
          ETHToken,
          amounts,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${yoETHSymbol} <> ${ETHToken} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
      });

      it('ETH getTopPoolsForToken', async function () {
        const poolLiquidity = await yoETH.getTopPoolsForToken(
          ETHToken.address,
          10,
        );
        console.log(`${ETHToken} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, ETHToken.address, dexKey);
      });

      it('yoETH getTopPoolsForToken', async function () {
        const poolLiquidity = await yoETH.getTopPoolsForToken(
          yoETHToken.address,
          10,
        );
        console.log(`${yoETHSymbol} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, yoETHToken.address, dexKey);
      });
    });
  });
});

describe('yoUSD', function () {
  const dexKey = 'yoUSD';
  const yoUSDSymbol = 'yoUSD';
  const USDSymbol = 'USDC';

  networks.forEach(({ name, network }) => {
    describe(`${name}`, () => {
      const yoUSDToken = Tokens[network][yoUSDSymbol];
      const USDToken = Tokens[network][USDSymbol];
      const amounts = [0n, BI_POWS[6], 2000000n];
      let dexHelper: DummyDexHelper;
      let blocknumber: number;
      let yoUSD: Yo;

      beforeAll(async () => {
        dexHelper = new DummyDexHelper(network);
        blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
        yoUSD = new Yo(network, dexKey, dexHelper);
        if (yoUSD.initializePricing) {
          await yoUSD.initializePricing(blocknumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume USDC -> yoUSD SELL', async function () {
        const pools = await yoUSD.getPoolIdentifiers(
          USDToken,
          yoUSDToken,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(
          `${USDToken.symbol} <> ${yoUSDSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoUSD.getPricesVolume(
          USDToken,
          yoUSDToken,
          amounts,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(
          `${USDToken.symbol} <> ${yoUSDSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume yoUSD -> USDC SELL', async function () {
        const pools = await yoUSD.getPoolIdentifiers(
          yoUSDToken,
          USDToken,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${yoUSDSymbol} <> ${USDToken} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoUSD.getPricesVolume(
          yoUSDToken,
          USDToken,
          amounts,
          SwapSide.SELL,
          blocknumber,
        );
        console.log(`${yoUSDSymbol} <> ${USDToken} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume USDC -> yoUSD BUY', async function () {
        const pools = await yoUSD.getPoolIdentifiers(
          USDToken,
          yoUSDToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${USDToken} <> ${yoUSDSymbol} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoUSD.getPricesVolume(
          USDToken,
          yoUSDToken,
          amounts,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${USDToken} <> ${yoUSDSymbol} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
      });

      it('getPoolIdentifiers and getPricesVolume yoUSD -> USDC BUY', async function () {
        const pools = await yoUSD.getPoolIdentifiers(
          yoUSDToken,
          USDToken,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${yoUSDSymbol} <> ${USDToken} Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await yoUSD.getPricesVolume(
          yoUSDToken,
          USDToken,
          amounts,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(`${yoUSDSymbol} <> ${USDToken} Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
      });

      it('USDC getTopPoolsForToken', async function () {
        const poolLiquidity = await yoUSD.getTopPoolsForToken(
          USDToken.address,
          10,
        );
        console.log(`${USDToken} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, USDToken.address, dexKey);
      });

      it('yoUSD getTopPoolsForToken', async function () {
        const poolLiquidity = await yoUSD.getTopPoolsForToken(
          yoUSDToken.address,
          10,
        );
        console.log(`${yoUSDSymbol} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, yoUSDToken.address, dexKey);
      });
    });
  });
});
