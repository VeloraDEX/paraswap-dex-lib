/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { checkOnChainPricingNonMulti } from './balancer-test-helpers';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { BalancerV3 } from './balancer-v3';
import {
  checkPoolPrices,
  checkConstantPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

async function testPricingOnNetwork(
  balancerV3: BalancerV3,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await balancerV3.getPoolIdentifiers(
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

  const poolPrices = await balancerV3.getPricesVolume(
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
  if (balancerV3.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey, false);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricingNonMulti(
    network,
    side,
    balancerV3,
    blockNumber,
    poolPrices!,
    amounts,
  );
}

describe('BalancerV3', function () {
  const dexKey = 'BalancerV3';
  let blockNumber: number;
  let balancerV3: BalancerV3;

  describe('Sepolia', () => {
    const network = Network.SEPOLIA;

    describe('Weighted Pool', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'bal';
      const destTokenSymbol = 'daiAave';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('Stable Pool', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'stataUSDC';
      const destTokenSymbol = 'stataUSDT';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('Boosted Path', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'usdcAave';
      const destTokenSymbol = 'usdtAave';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
        );
      });

      // TODO 1 WEI rounding issue in maths - investigating
      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;

    describe('Weighted Pool', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'USDCe';
      const destTokenSymbol = 'sDAI';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('Stable Pool', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'WXDAI';
      const destTokenSymbol = 'COW';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('Boosted Path', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'waGnoWETH';
      const destTokenSymbol = 'waGnowstETH';

      const amountsForSell = [
        0n,
        (1n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (2n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (3n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (4n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (5n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (6n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (7n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (8n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (9n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
        (10n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 1000n,
      ];

      const amountsForBuy = [
        0n,
        (1n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (2n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (3n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (4n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (5n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (6n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (7n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (8n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (9n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
        (10n * BI_POWS[tokens[destTokenSymbol].decimals]) / 1000n,
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
        );
      });

      // TODO 1 WEI rounding issue in maths - investigating
      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );

        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('Buffer, Nested Rate', () => {
      /*
      The Gnosis pool, 0x272d6be442e30d7c87390edeb9b96f1e84cecd8d uses a rate provider that is nested.
      So unwrap rate does not equal rate between aave wsteth and eth.
      This particular case the rate provider accounts for growth of wsteth in terms of weth and the additional aave yield.
      This highlighted that rateProvider can not be used for buffer wrap/unwrap which instead should use erc4626 rate.
      */
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'wstETH';
      const destTokenSymbol = 'waGnowstETH';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        100n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        100n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
          balancerV3,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
        );
      });
    });
  });

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    describe('Token/Underlying With Different Decimals', () => {
      /*
      Mainnet Pool, 0x5dd88b3aa3143173eb26552923922bdf33f50949 has an ERC4626 token with 18 decimals that uses a 6 decimal underlying.
      Note for maths: Instead of manually adding support for each ERC4626 implementation (e.g. stata with Ray maths) we always use an
      18 decimal scaled rate and do 18 decimal maths to convert. We may end up loosing 100% accuracy but thats deemed acceptable.
      */
      describe('Buffer wrap 6decimal>18decimal', () => {
        const dexHelper = new DummyDexHelper(network);

        const tokens = Tokens[network];
        const srcTokenSymbol = 'USDC';
        const destTokenSymbol = 'steakUSDC';

        const amountsForSell = [
          0n,
          1n * BI_POWS[tokens[srcTokenSymbol].decimals],
          10n * BI_POWS[tokens[srcTokenSymbol].decimals],
        ];

        const amountsForBuy = [
          0n,
          1n * BI_POWS[tokens[destTokenSymbol].decimals],
          10n * BI_POWS[tokens[destTokenSymbol].decimals],
        ];

        beforeAll(async () => {
          blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
          balancerV3 = new BalancerV3(network, dexKey, dexHelper);
          if (balancerV3.initializePricing) {
            await balancerV3.initializePricing(blockNumber);
          }
        });

        it('getPoolIdentifiers and getPricesVolume SELL', async function () {
          await testPricingOnNetwork(
            balancerV3,
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
            balancerV3,
            network,
            dexKey,
            blockNumber,
            srcTokenSymbol,
            destTokenSymbol,
            SwapSide.BUY,
            amountsForBuy,
          );
        });
      });
      describe('Buffer unwrap 18decimal>6decimal', () => {
        const dexHelper = new DummyDexHelper(network);

        const tokens = Tokens[network];
        const srcTokenSymbol = 'steakUSDC';
        const destTokenSymbol = 'USDC';

        const amountsForSell = [
          0n,
          1n * BI_POWS[tokens[srcTokenSymbol].decimals],
          10n * BI_POWS[tokens[srcTokenSymbol].decimals],
        ];

        const amountsForBuy = [
          0n,
          1n * BI_POWS[tokens[destTokenSymbol].decimals],
          10n * BI_POWS[tokens[destTokenSymbol].decimals],
        ];

        beforeAll(async () => {
          blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
          balancerV3 = new BalancerV3(network, dexKey, dexHelper);
          if (balancerV3.initializePricing) {
            await balancerV3.initializePricing(blockNumber);
          }
        });

        it('getPoolIdentifiers and getPricesVolume SELL', async function () {
          await testPricingOnNetwork(
            balancerV3,
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
            balancerV3,
            network,
            dexKey,
            blockNumber,
            srcTokenSymbol,
            destTokenSymbol,
            SwapSide.BUY,
            amountsForBuy,
          );
        });
      });
      describe('Full boosted path', () => {
        const dexHelper = new DummyDexHelper(network);

        const tokens = Tokens[network];
        const srcTokenSymbol = 'wUSDL';
        const destTokenSymbol = 'USDC';

        const amountsForSell = [
          0n,
          1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        ];

        const amountsForBuy = [
          0n,
          1n * BI_POWS[tokens[destTokenSymbol].decimals],
        ];

        beforeAll(async () => {
          blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
          balancerV3 = new BalancerV3(network, dexKey, dexHelper);
          if (balancerV3.initializePricing) {
            await balancerV3.initializePricing(blockNumber);
          }
        });

        it('getPoolIdentifiers and getPricesVolume SELL', async function () {
          await testPricingOnNetwork(
            balancerV3,
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
            balancerV3,
            network,
            dexKey,
            blockNumber,
            srcTokenSymbol,
            destTokenSymbol,
            SwapSide.BUY,
            amountsForBuy,
          );
        });
      });
    });
  });

  describe('Base', () => {
    const network = Network.BASE;

    describe('Stable Pool', () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];
      const srcTokenSymbol = 'wstETH';
      const destTokenSymbol = 'WETH';

      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];

      const amountsForBuy = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          balancerV3,
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
          balancerV3,
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
        const newBalancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (newBalancerV3.updatePoolState) {
          await newBalancerV3.updatePoolState();
        }
        const poolLiquidity = await newBalancerV3.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBalancerV3.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });
});

// Add back once multicall queries are working
/*
function decodeQuerySwapSingleTokenResult(results: Result, side: SwapSide) {
  const balancerRouter = new Interface(balancerRouterAbi);
  return results.map(result => {
    const parsed = balancerRouter.decodeFunctionResult(
      side === SwapSide.SELL
        ? `querySwapSingleTokenExactIn`
        : `querySwapSingleTokenExactOut`,
      result,
    );
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  network: number,
  side: SwapSide,
  balancerV3: BalancerV3,
  blockNumber: number,
  prices: ExchangePrices<BalancerV3Data>,
  amounts: bigint[],
) {
  // test match for each returned price
  for (const price of prices) {
    const readerCallData = getQuerySwapSingleTokenCalldata(
      network,
      amounts,
      price.data.steps[0],
      side,
    );
    const readerResult = (
      await balancerV3.dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
    const expectedPrices = [0n].concat(
      decodeQuerySwapSingleTokenResult(readerResult, side),
    );
    expect(price.prices).toEqual(expectedPrices);
  }
}
  */
