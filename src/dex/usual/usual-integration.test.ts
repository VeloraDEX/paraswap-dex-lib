/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import {
  Network,
  NO_USD_LIQUIDITY,
  SwapSide,
  UNLIMITED_USD_LIQUIDITY,
} from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import {
  checkPoolPrices,
  checkConstantPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { UsualMWrappedM } from './usual-m-wrapped-m';
import { UsualMUsd0 } from './usual-m-usd0';
import { Usual } from './usual';
import { UsualBond } from './usual-bond';
import { UsdcUsualUSDC } from './usdc-usual-usdc';
import { UsualUSDCUsd0 } from './usual-usdc-usd0';

async function testPricingOnNetwork(
  usual: Usual,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
) {
  const networkTokens = Tokens[network];

  console.log(amounts);

  const pools = await usual.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await usual.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  if (usual.hasConstantPriceLargeAmounts) {
    const fromDec = networkTokens[srcTokenSymbol].decimals;
    const toDec = networkTokens[destTokenSymbol].decimals;
    const expectedOut = amounts.map(
      a => (a * BI_POWS[toDec]) / BI_POWS[fromDec],
    );
    checkConstantPoolPrices(poolPrices!, expectedOut, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  checkPoolPrices(poolPrices!, amounts, side, dexKey);
}

describe('UsualBond', function () {
  const dexKey = 'UsualBond';
  let blockNumber: number;
  let usualBond: UsualBond;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    // Don't forget to update relevant tokens in constant-e2e.ts

    const amountsForSell = [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
      4n * BI_POWS[18],
      5n * BI_POWS[18],
      6n * BI_POWS[18],
      7n * BI_POWS[18],
      8n * BI_POWS[18],
      9n * BI_POWS[18],
      10n * BI_POWS[18],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      usualBond = new UsualBond(network, dexKey, dexHelper);
      if (usualBond.initializePricing) {
        await usualBond.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        usualBond,
        network,
        dexKey,
        blockNumber,
        'USD0',
        'USD0++',
        SwapSide.SELL,
        amountsForSell,
        '',
      );
    });

    it('getTopPoolsForToken: USD0', async function () {
      const tokenA = Tokens[network]['USD0'];
      const dexHelper = new DummyDexHelper(network);
      const usualBond = new UsualBond(network, dexKey, dexHelper);

      const poolLiquidity = await usualBond.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });

    it('getTopPoolsForToken: USD0++', async function () {
      const tokenA = Tokens[network]['USD0++'];
      const dexHelper = new DummyDexHelper(network);
      const usualBond = new UsualBond(network, dexKey, dexHelper);

      const poolLiquidity = await usualBond.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });
  });
});

describe('WrappedM<>UsualM', function () {
  const dexKey = 'UsualMWrappedM';
  let blockNumber: number;
  let usualMWrappedM: UsualMWrappedM;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    // Don't forget to update relevant tokens in constant-e2e.ts

    const amountsForSell = [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
      4n * BI_POWS[18],
      5n * BI_POWS[18],
      6n * BI_POWS[18],
      7n * BI_POWS[18],
      8n * BI_POWS[18],
      9n * BI_POWS[18],
      10n * BI_POWS[18],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      usualMWrappedM = new UsualMWrappedM(network, dexKey, dexHelper);
      if (usualMWrappedM.initializePricing) {
        await usualMWrappedM.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        usualMWrappedM,
        network,
        dexKey,
        blockNumber,
        'WrappedM',
        'UsualM',
        SwapSide.SELL,
        amountsForSell,
        '',
      );
    });

    it('getTopPoolsForToken: WrappedM', async function () {
      const tokenA = Tokens[network]['WrappedM'];
      const tokenB = Tokens[network]['UsualM'];
      const dexHelper = new DummyDexHelper(network);
      const usualMWrappedM = new UsualMWrappedM(network, dexKey, dexHelper);

      const poolLiquidityA = await usualMWrappedM.getTopPoolsForToken(
        tokenA.address,
        10,
      );

      const poolLiquidityB = await usualMWrappedM.getTopPoolsForToken(
        tokenB.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidityA, null, 2),
      );

      // swap is available only from WrappedM to UsualM
      expect(poolLiquidityA[0].liquidityUSD).toBe(UNLIMITED_USD_LIQUIDITY);
      expect(poolLiquidityB[0].liquidityUSD).toBe(NO_USD_LIQUIDITY);

      checkPoolsLiquidity(poolLiquidityA, tokenA.address, dexKey);
    });

    it('getTopPoolsForToken: UsualM', async function () {
      const tokenA = Tokens[network]['UsualM'];
      const dexHelper = new DummyDexHelper(network);
      const usualMWrappedM = new UsualMWrappedM(network, dexKey, dexHelper);

      const poolLiquidity = await usualMWrappedM.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });
  });
});

describe('UsualM<>USD0', function () {
  const dexKey = 'UsualMUsd0';
  let blockNumber: number;
  let usualMUsd0: UsualMUsd0;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    // Don't forget to update relevant tokens in constant-e2e.ts

    const amountsForSell = [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
      4n * BI_POWS[18],
      5n * BI_POWS[18],
      6n * BI_POWS[18],
      7n * BI_POWS[18],
      8n * BI_POWS[18],
      9n * BI_POWS[18],
      10n * BI_POWS[18],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      usualMUsd0 = new UsualMUsd0(network, dexKey, dexHelper);
      if (usualMUsd0.initializePricing) {
        await usualMUsd0.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        usualMUsd0,
        network,
        dexKey,
        blockNumber,
        'UsualM',
        'USD0',
        SwapSide.SELL,
        amountsForSell,
        '',
      );
    });

    it('getTopPoolsForToken: UsualM', async function () {
      const tokenA = Tokens[network]['UsualM'];
      const dexHelper = new DummyDexHelper(network);
      const usualMUsd0 = new UsualMUsd0(network, dexKey, dexHelper);

      const poolLiquidity = await usualMUsd0.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });

    it('getTopPoolsForToken: USD0', async function () {
      const tokenA = Tokens[network]['USD0'];
      const dexHelper = new DummyDexHelper(network);
      const usualMUsd0 = new UsualMUsd0(network, dexKey, dexHelper);

      const poolLiquidity = await usualMUsd0.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });
  });
});

describe('USDC<>UsualUSDC', function () {
  const dexKey = 'UsdcUsualUSDC';
  let blockNumber: number;
  let usdcUusdc: UsdcUsualUSDC;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'UsualUSDC';

    const amountsForSell = [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
      4n * BI_POWS[18],
      5n * BI_POWS[18],
      6n * BI_POWS[18],
      7n * BI_POWS[18],
      8n * BI_POWS[18],
      9n * BI_POWS[18],
      10n * BI_POWS[18],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      usdcUusdc = new UsdcUsualUSDC(network, dexKey, dexHelper);
      if (usdcUusdc.initializePricing) {
        await usdcUusdc.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        usdcUusdc,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        usdcUusdc,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForSell,
        '',
      );
    });

    it(`getTopPoolsForToken: ${srcTokenSymbol}`, async function () {
      const tokenA = Tokens[network][srcTokenSymbol];
      const dexHelper = new DummyDexHelper(network);
      const usdcUusdc = new UsdcUsualUSDC(network, dexKey, dexHelper);

      const poolLiquidity = await usdcUusdc.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      expect(poolLiquidity[0].liquidityUSD).toBe(UNLIMITED_USD_LIQUIDITY);

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });

    it(`getTopPoolsForToken: ${destTokenSymbol}`, async function () {
      const tokenA = Tokens[network][destTokenSymbol];
      const dexHelper = new DummyDexHelper(network);
      const usdcUusdc = new UsdcUsualUSDC(network, dexKey, dexHelper);

      const poolLiquidity = await usdcUusdc.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      expect(poolLiquidity[0].liquidityUSD).toBe(NO_USD_LIQUIDITY);
    });
  });
});

describe('UsualUSDC<>USD0', function () {
  const dexKey = 'UsualUSDCUsd0';
  let blockNumber: number;
  let uusdcUsd0: UsualUSDCUsd0;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const srcTokenSymbol = 'UsualUSDC';
    const destTokenSymbol = 'USD0';

    const amountsForSell = [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
      4n * BI_POWS[18],
      5n * BI_POWS[18],
      6n * BI_POWS[18],
      7n * BI_POWS[18],
      8n * BI_POWS[18],
      9n * BI_POWS[18],
      10n * BI_POWS[18],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      uusdcUsd0 = new UsualUSDCUsd0(network, dexKey, dexHelper);
      if (uusdcUsd0.initializePricing) {
        await uusdcUsd0.initializePricing(blockNumber);
      }
    });

    it(`getPoolIdentifiers and getPricesVolume SELL`, async function () {
      await testPricingOnNetwork(
        uusdcUsd0,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '',
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY`, async function () {
      await testPricingOnNetwork(
        uusdcUsd0,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForSell,
        '',
      );
    });

    it(`getTopPoolsForToken: ${srcTokenSymbol}`, async function () {
      const tokenA = Tokens[network][srcTokenSymbol];
      const dexHelper = new DummyDexHelper(network);
      const uusdcUsd0 = new UsualUSDCUsd0(network, dexKey, dexHelper);

      const poolLiquidity = await uusdcUsd0.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      expect(poolLiquidity[0].liquidityUSD).toBe(UNLIMITED_USD_LIQUIDITY);

      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    });

    it(`getTopPoolsForToken: ${destTokenSymbol}`, async function () {
      const tokenA = Tokens[network][destTokenSymbol];
      const dexHelper = new DummyDexHelper(network);
      const uusdcUsd0 = new UsualUSDCUsd0(network, dexKey, dexHelper);

      const poolLiquidity = await uusdcUsd0.getTopPoolsForToken(
        tokenA.address,
        10,
      );
      console.log(
        `${tokenA.symbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      expect(poolLiquidity[0].liquidityUSD).toBe(NO_USD_LIQUIDITY);
    });
  });
});
