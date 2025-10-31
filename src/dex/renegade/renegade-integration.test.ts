import dotenv from 'dotenv';
dotenv.config();

import { Tokens } from '../../../tests/constants-e2e';
import {
  checkConstantPoolPrices,
  checkPoolPrices,
  checkPoolsLiquidity,
  sleep,
} from '../../../tests/utils';
import { BI_POWS } from '../../bigint-constants';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { RENEGADE_NAME } from './constants';
import { Renegade } from './renegade';

async function testPricingOnNetwork(
  renegade: Renegade,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await renegade.getPoolIdentifiers(
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

  const poolPrices = await renegade.getPricesVolume(
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
  if (renegade.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey, false);
  }
}

describe('Renegade', function () {
  const dexKey = RENEGADE_NAME;
  let blockNumber: number;
  let renegade: Renegade;

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'USDC';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      1000n * BI_POWS[tokens[destTokenSymbol].decimals],
      2000n * BI_POWS[tokens[destTokenSymbol].decimals],
      3000n * BI_POWS[tokens[destTokenSymbol].decimals],
      4000n * BI_POWS[tokens[destTokenSymbol].decimals],
      5000n * BI_POWS[tokens[destTokenSymbol].decimals],
      6000n * BI_POWS[tokens[destTokenSymbol].decimals],
      7000n * BI_POWS[tokens[destTokenSymbol].decimals],
      8000n * BI_POWS[tokens[destTokenSymbol].decimals],
      9000n * BI_POWS[tokens[destTokenSymbol].decimals],
      10000n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      renegade = new Renegade(network, dexKey, dexHelper);
      await renegade.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterAll(async () => {
      if (renegade.releaseResources) {
        await renegade.releaseResources();
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        renegade,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        renegade,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newRenegade = new Renegade(network, dexKey, dexHelper);
      if (newRenegade.updatePoolState) {
        await newRenegade.updatePoolState();
      }
      const poolLiquidity = await newRenegade.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newRenegade.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it('getTopPoolsForToken for USDC', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newRenegade = new Renegade(network, dexKey, dexHelper);
      if (newRenegade.updatePoolState) {
        await newRenegade.updatePoolState();
      }
      const limit = 10;
      const poolLiquidity = await newRenegade.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        limit,
      );
      console.log(
        `${destTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      // Verify limit is respected
      expect(poolLiquidity.length).toBeLessThanOrEqual(limit);

      // Verify pools are sorted in descending order of liquidityUSD
      for (let i = 0; i < poolLiquidity.length - 1; i++) {
        expect(poolLiquidity[i].liquidityUSD).toBeGreaterThanOrEqual(
          poolLiquidity[i + 1].liquidityUSD,
        );
      }

      if (!newRenegade.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });

    it('should return null when quote is not USDC', async function () {
      // Test with two non-USDC tokens (WETH -> DAI)
      const nonUsdcSrcToken = tokens['WETH'];
      const nonUsdcDestToken = tokens['DAI'];
      const amounts = [BI_POWS[nonUsdcSrcToken.decimals]];

      const poolPrices = await renegade.getPricesVolume(
        nonUsdcSrcToken,
        nonUsdcDestToken,
        amounts,
        SwapSide.SELL,
        blockNumber,
      );

      expect(poolPrices).toBeNull();
    });

    it('should return null when both tokens are unsupported by Renegade API', async function () {
      // Test with two tokens that are not supported by Renegade API (BAL -> SUSHI)
      const unsupportedSrcToken = tokens['BAL'];
      const unsupportedDestToken = tokens['SUSHI'];
      const amounts = [BI_POWS[unsupportedSrcToken.decimals]];

      const poolPrices = await renegade.getPricesVolume(
        unsupportedSrcToken,
        unsupportedDestToken,
        amounts,
        SwapSide.SELL,
        blockNumber,
      );

      expect(poolPrices).toBeNull();
    });
  });

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network, 'https://mainnet.base.org');

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'USDC';

    const amountsForSell = [0n, BI_POWS[tokens[srcTokenSymbol].decimals] / 10n];

    const amountsForBuy = [
      0n,
      1000n * BI_POWS[tokens[destTokenSymbol].decimals],
      2000n * BI_POWS[tokens[destTokenSymbol].decimals],
      3000n * BI_POWS[tokens[destTokenSymbol].decimals],
      4000n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      renegade = new Renegade(network, dexKey, dexHelper);
      await renegade.initializePricing(blockNumber);
      await sleep(5000);
    });

    afterAll(async () => {
      if (renegade.releaseResources) {
        await renegade.releaseResources();
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        renegade,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        renegade,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newRenegade = new Renegade(network, dexKey, dexHelper);
      if (newRenegade.updatePoolState) {
        await newRenegade.updatePoolState();
      }
      const poolLiquidity = await newRenegade.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newRenegade.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it('getTopPoolsForToken for USDC', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newRenegade = new Renegade(network, dexKey, dexHelper);
      if (newRenegade.updatePoolState) {
        await newRenegade.updatePoolState();
      }
      const limit = 10;
      const poolLiquidity = await newRenegade.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        limit,
      );
      console.log(
        `${destTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      // Verify limit is respected
      expect(poolLiquidity.length).toBeLessThanOrEqual(limit);

      // Verify pools are sorted in descending order of liquidityUSD
      for (let i = 0; i < poolLiquidity.length - 1; i++) {
        expect(poolLiquidity[i].liquidityUSD).toBeGreaterThanOrEqual(
          poolLiquidity[i + 1].liquidityUSD,
        );
      }

      if (!newRenegade.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });

    it('should return null when quote is not USDC', async function () {
      // Test with two non-USDC tokens (WETH -> DAI)
      const nonUsdcSrcToken = tokens['WETH'];
      const nonUsdcDestToken = tokens['DAI'];
      const amounts = [BI_POWS[nonUsdcSrcToken.decimals]];

      const poolPrices = await renegade.getPricesVolume(
        nonUsdcSrcToken,
        nonUsdcDestToken,
        amounts,
        SwapSide.SELL,
        blockNumber,
      );

      expect(poolPrices).toBeNull();
    });

    it('should return null when both tokens are unsupported by Renegade API', async function () {
      // Test with two tokens that are not supported by Renegade API (PRIME -> MAV)
      const unsupportedSrcToken = tokens['PRIME'];
      const unsupportedDestToken = tokens['MAV'];
      const amounts = [BI_POWS[unsupportedSrcToken.decimals]];

      const poolPrices = await renegade.getPricesVolume(
        unsupportedSrcToken,
        unsupportedDestToken,
        amounts,
        SwapSide.SELL,
        blockNumber,
      );

      expect(poolPrices).toBeNull();
    });
  });
});
