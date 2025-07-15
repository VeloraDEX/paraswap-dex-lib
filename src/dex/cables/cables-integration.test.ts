/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Cables } from './cables';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
  sleep,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

async function testPricingOnNetwork(
  cables: Cables,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await cables.getPoolIdentifiers(
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

  const poolPrices = await cables.getPricesVolume(
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
  if (cables.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }
}

describe('Cables', function () {
  const dexKey = 'Cables';
  let blockNumber: number;
  let cables: Cables;

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const tokenASymbol = 'USDC';
    const tokenBSymbol = 'USDT';

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
      cables = new Cables(network, dexKey, dexHelper);
      await cables.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterEach(async () => {
      if (cables.releaseResources) cables.releaseResources();
      await sleep(5000);
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        cables,
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
        cables,
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
        cables,
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
        cables,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.BUY,
        amountsForTokenA,
      );
    });

    it.skip('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const cables = new Cables(network, dexKey, dexHelper);
      const poolLiquidity = await cables.getTopPoolsForToken(
        tokens[tokenASymbol].address,
        10,
      );
      console.log(
        `${tokenASymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );
      console.log(
        `${tokenASymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!cables.hasConstantPriceLargeAmounts) {
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

    const tokenASymbol = 'USDC';
    const tokenBSymbol = 'USDT';

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
      cables = new Cables(network, dexKey, dexHelper);
      await cables.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterEach(async () => {
      if (cables.releaseResources) cables.releaseResources();
      await sleep(5000);
    });

    it(`getPoolIdentifiers and getPricesVolume SELL ${tokenASymbol} ${tokenBSymbol}`, async function () {
      await testPricingOnNetwork(
        cables,
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
        cables,
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
        cables,
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
        cables,
        network,
        dexKey,
        blockNumber,
        tokenBSymbol,
        tokenASymbol,
        SwapSide.BUY,
        amountsForTokenA,
      );
    });

    describe.skip('getTopPoolsForToken', () => {
      it('USDC getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const tokenSymbol = 'USDC';
        const cables = new Cables(network, dexKey, dexHelper);
        const poolLiquidity = await cables.getTopPoolsForToken(
          tokens[tokenSymbol].address,
          10,
        );
        console.log(
          `${tokenASymbol} Top Pools:`,
          JSON.stringify(poolLiquidity, null, 2),
        );

        if (!cables.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][tokenASymbol].address,
            dexKey,
          );
        }
      });

      it('WETH getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const tokenSymbol = 'WETH';
        const cables = new Cables(network, dexKey, dexHelper);
        const poolLiquidity = await cables.getTopPoolsForToken(
          tokens[tokenSymbol].address,
          10,
        );
        console.log(
          `${tokenASymbol} Top Pools:`,
          JSON.stringify(poolLiquidity, null, 2),
        );

        if (!cables.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][tokenASymbol].address,
            dexKey,
          );
        }
      });

      it('ETH getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const tokenSymbol = 'ETH';
        const cables = new Cables(network, dexKey, dexHelper);
        const poolLiquidity = await cables.getTopPoolsForToken(
          tokens[tokenSymbol].address,
          10,
        );
        console.log(
          `${tokenASymbol} Top Pools:`,
          JSON.stringify(poolLiquidity, null, 2),
        );

        if (!cables.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][tokenASymbol].address,
            dexKey,
          );
        }
      });

      it('ARB getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const tokenSymbol = 'ARB';
        const cables = new Cables(network, dexKey, dexHelper);
        const poolLiquidity = await cables.getTopPoolsForToken(
          tokens[tokenSymbol].address,
          10,
        );
        console.log(
          `${tokenASymbol} Top Pools:`,
          JSON.stringify(poolLiquidity, null, 2),
        );

        if (!cables.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][tokenASymbol].address,
            dexKey,
          );
        }
      });
    });
  });
});
