/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Dexalot } from './dexalot';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
  sleep,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

async function testPricingOnNetwork(
  dexalot: Dexalot,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await dexalot.getPoolIdentifiers(
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

  const poolPrices = await dexalot.getPricesVolume(
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
  if (dexalot.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }
}

describe('Dexalot', function () {
  const dexKey = 'Dexalot';
  let blockNumber: number;
  let dexalot: Dexalot;

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const tokenASymbol = 'AVAX';
    const tokenBSymbol = 'USDC';

    const amountsForTokenA = [
      0n,
      1n * BI_POWS[tokens[tokenASymbol].decimals],
      2n * BI_POWS[tokens[tokenASymbol].decimals],
      3n * BI_POWS[tokens[tokenASymbol].decimals],
      4n * BI_POWS[tokens[tokenASymbol].decimals],
      5n * BI_POWS[tokens[tokenASymbol].decimals],
      6n * BI_POWS[tokens[tokenASymbol].decimals],
      7n * BI_POWS[tokens[tokenASymbol].decimals],
      8n * BI_POWS[tokens[tokenASymbol].decimals],
      9n * BI_POWS[tokens[tokenASymbol].decimals],
      10n * BI_POWS[tokens[tokenASymbol].decimals],
    ];

    const amountsForTokenB = [
      0n,
      1n * BI_POWS[tokens[tokenBSymbol].decimals],
      2n * BI_POWS[tokens[tokenBSymbol].decimals],
      3n * BI_POWS[tokens[tokenBSymbol].decimals],
      4n * BI_POWS[tokens[tokenBSymbol].decimals],
      5n * BI_POWS[tokens[tokenBSymbol].decimals],
      6n * BI_POWS[tokens[tokenBSymbol].decimals],
      7n * BI_POWS[tokens[tokenBSymbol].decimals],
      8n * BI_POWS[tokens[tokenBSymbol].decimals],
      9n * BI_POWS[tokens[tokenBSymbol].decimals],
      10n * BI_POWS[tokens[tokenBSymbol].decimals],
    ];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      dexalot = new Dexalot(network, dexKey, dexHelper);
      await dexalot.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterEach(async () => {
      dexalot.releaseResources();
      await sleep(5000);
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.SELL,
        amountsForTokenA,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.BUY,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.SELL,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.BUY,
        amountsForTokenA,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const dexalot = new Dexalot(network, dexKey, dexHelper);
      const poolLiquidity = await dexalot.getTopPoolsForToken(
        tokens[tokenASymbol].address,
        10,
      );
      console.log(`${tokenASymbol} Top Pools:`, poolLiquidity);

      if (!dexalot.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][tokenASymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const tokenASymbol = 'USDT';
    const tokenBSymbol = 'USDC';

    const amountsForTokenA = [
      0n,
      1n * BI_POWS[tokens[tokenASymbol].decimals],
      2n * BI_POWS[tokens[tokenASymbol].decimals],
      3n * BI_POWS[tokens[tokenASymbol].decimals],
      4n * BI_POWS[tokens[tokenASymbol].decimals],
      5n * BI_POWS[tokens[tokenASymbol].decimals],
      6n * BI_POWS[tokens[tokenASymbol].decimals],
      7n * BI_POWS[tokens[tokenASymbol].decimals],
      8n * BI_POWS[tokens[tokenASymbol].decimals],
      9n * BI_POWS[tokens[tokenASymbol].decimals],
      10n * BI_POWS[tokens[tokenASymbol].decimals],
    ];

    const amountsForTokenB = [
      0n,
      1n * BI_POWS[tokens[tokenBSymbol].decimals],
      2n * BI_POWS[tokens[tokenBSymbol].decimals],
      3n * BI_POWS[tokens[tokenBSymbol].decimals],
      4n * BI_POWS[tokens[tokenBSymbol].decimals],
      5n * BI_POWS[tokens[tokenBSymbol].decimals],
      6n * BI_POWS[tokens[tokenBSymbol].decimals],
      7n * BI_POWS[tokens[tokenBSymbol].decimals],
      8n * BI_POWS[tokens[tokenBSymbol].decimals],
      9n * BI_POWS[tokens[tokenBSymbol].decimals],
      10n * BI_POWS[tokens[tokenBSymbol].decimals],
    ];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      dexalot = new Dexalot(network, dexKey, dexHelper);
      await dexalot.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterEach(async () => {
      dexalot.releaseResources();
      await sleep(5000);
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.SELL,
        amountsForTokenA,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.BUY,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.SELL,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.BUY,
        amountsForTokenA,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const dexalot = new Dexalot(network, dexKey, dexHelper);
      const poolLiquidity = await dexalot.getTopPoolsForToken(
        tokens[tokenASymbol].address,
        10,
      );
      console.log(`${tokenASymbol} Top Pools:`, poolLiquidity);

      if (!dexalot.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][tokenASymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const tokenASymbol = 'WETH';
    const tokenBSymbol = 'USDC';

    const tokenAScaling = BI_POWS[tokens[tokenASymbol].decimals - 3];
    const amountsForTokenA = [
      0n,
      1n * tokenAScaling,
      2n * tokenAScaling,
      3n * tokenAScaling,
      4n * tokenAScaling,
      5n * tokenAScaling,
      6n * tokenAScaling,
      7n * tokenAScaling,
      8n * tokenAScaling,
      9n * tokenAScaling,
      10n * tokenAScaling,
    ];

    const amountsForTokenB = [
      0n,
      1n * BI_POWS[tokens[tokenBSymbol].decimals],
      2n * BI_POWS[tokens[tokenBSymbol].decimals],
      3n * BI_POWS[tokens[tokenBSymbol].decimals],
      4n * BI_POWS[tokens[tokenBSymbol].decimals],
      5n * BI_POWS[tokens[tokenBSymbol].decimals],
      6n * BI_POWS[tokens[tokenBSymbol].decimals],
      7n * BI_POWS[tokens[tokenBSymbol].decimals],
      8n * BI_POWS[tokens[tokenBSymbol].decimals],
      9n * BI_POWS[tokens[tokenBSymbol].decimals],
      10n * BI_POWS[tokens[tokenBSymbol].decimals],
    ];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      dexalot = new Dexalot(network, dexKey, dexHelper);
      await dexalot.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterEach(async () => {
      dexalot.releaseResources();
      await sleep(5000);
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.SELL,
        amountsForTokenA,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.BUY,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.SELL,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.BUY,
        amountsForTokenA,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const dexalot = new Dexalot(network, dexKey, dexHelper);
      const poolLiquidity = await dexalot.getTopPoolsForToken(
        tokens[tokenASymbol].address,
        10,
      );
      console.log(`${tokenASymbol} Top Pools:`, poolLiquidity);

      if (!dexalot.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][tokenASymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('BSC', () => {
    const network = Network.BSC;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const tokenASymbol = 'USDT';
    const tokenBSymbol = 'USDC';

    const tokenAScaling = BI_POWS[tokens[tokenASymbol].decimals - 3];
    const amountsForTokenA = [
      0n,
      1n * tokenAScaling,
      2n * tokenAScaling,
      3n * tokenAScaling,
      4n * tokenAScaling,
      5n * tokenAScaling,
      6n * tokenAScaling,
      7n * tokenAScaling,
      8n * tokenAScaling,
      9n * tokenAScaling,
      10n * tokenAScaling,
    ];

    const amountsForTokenB = [
      0n,
      1n * BI_POWS[tokens[tokenBSymbol].decimals],
      2n * BI_POWS[tokens[tokenBSymbol].decimals],
      3n * BI_POWS[tokens[tokenBSymbol].decimals],
      4n * BI_POWS[tokens[tokenBSymbol].decimals],
      5n * BI_POWS[tokens[tokenBSymbol].decimals],
      6n * BI_POWS[tokens[tokenBSymbol].decimals],
      7n * BI_POWS[tokens[tokenBSymbol].decimals],
      8n * BI_POWS[tokens[tokenBSymbol].decimals],
      9n * BI_POWS[tokens[tokenBSymbol].decimals],
      10n * BI_POWS[tokens[tokenBSymbol].decimals],
    ];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      dexalot = new Dexalot(network, dexKey, dexHelper);
      await dexalot.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterEach(async () => {
      dexalot.releaseResources();
      await sleep(5000);
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.SELL,
        amountsForTokenA,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenASymbol,
        tokenBSymbol,
        SwapSide.BUY,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.SELL,
        amountsForTokenB,
      );
    });

    it(`getPoolIdentifiers and getPricesVolume BUY ${tokenBSymbol} ${tokenASymbol}`, async function () {
      await testPricingOnNetwork(
        dexalot,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.BUY,
        amountsForTokenA,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const dexalot = new Dexalot(network, dexKey, dexHelper);
      const poolLiquidity = await dexalot.getTopPoolsForToken(
        tokens[tokenASymbol].address,
        10,
      );
      console.log(`${tokenASymbol} Top Pools:`, poolLiquidity);

      if (!dexalot.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][tokenASymbol].address,
          dexKey,
        );
      }
    });
  });
});
