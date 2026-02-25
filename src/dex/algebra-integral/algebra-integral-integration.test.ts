/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AlgebraIntegral } from './algebra-integral';
import { BlackholeCL } from './forks/blackhole-cl';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '@paraswap/core';
import { NULL_ADDRESS } from '../../constants';

async function checkOnChainPricing(
  algebraIntegral: AlgebraIntegral,
  blockNumber: number,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  deployer: Address,
  amounts: bigint[],
  side: SwapSide,
) {
  const isSELL = side === SwapSide.SELL;
  const amountsToCheck = amounts.slice(1);

  const calldata = amountsToCheck.map(amount => {
    const quoteData = algebraIntegral.buildQuoteCallData(
      tokenIn,
      tokenOut,
      deployer,
      amount,
      isSELL,
    );
    return {
      target: quoteData.target,
      callData: quoteData.callData,
    };
  });

  const readerResult = (
    await algebraIntegral.dexHelper.multiContract.methods
      .aggregate(calldata)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    amountsToCheck.map((amount, i) => {
      const quoteData = algebraIntegral.buildQuoteCallData(
        tokenIn,
        tokenOut,
        deployer,
        amount,
        isSELL,
      );
      return quoteData.decodeFunction(readerResult[i]);
    }),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  algebraIntegral: AlgebraIntegral,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  deployer: Address,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await algebraIntegral.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );
  console.log('POOLS', pools);
  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await algebraIntegral.getPricesVolume(
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
  if (algebraIntegral.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  console.log(poolPrices);

  const matchingPoolPrice = poolPrices!.find(
    p => p.data.path[0].deployer.toLowerCase() === deployer.toLowerCase(),
  );
  expect(matchingPoolPrice).toBeDefined();

  await checkOnChainPricing(
    algebraIntegral,
    blockNumber,
    matchingPoolPrice!.prices,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
    deployer,
    amounts,
    side,
  );
}

describe('QuickSwapV4', function () {
  const dexKey = 'QuickSwapV4';
  let blockNumber: number;
  let algebra: AlgebraIntegral;

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
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
      (1n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (2n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (3n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (4n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (5n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (6n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (7n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (8n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (9n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
      (10n * BI_POWS[tokens[destTokenSymbol].decimals]) / 100n,
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      algebra = new AlgebraIntegral(network, dexKey, dexHelper);
      if (algebra.initializePricing) {
        await algebra.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        algebra,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        NULL_ADDRESS,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        algebra,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        NULL_ADDRESS,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAlgebra = new AlgebraIntegral(network, dexKey, dexHelper);

      if (newAlgebra.updatePoolState) {
        await newAlgebra.updatePoolState();
      }

      const poolLiquidity = await newAlgebra.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newAlgebra.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});

describe('BlackholeCL', function () {
  const dexKey = 'BlackholeCL';
  let blockNumber: number;
  let algebra: BlackholeCL;

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'WAVAX';
    const deployer = '0xdcfccf2e8c4efbba9127b80eac76c5a122125d29';

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
      algebra = new BlackholeCL(network, dexKey, dexHelper);
      if (algebra.initializePricing) {
        await algebra.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        algebra,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        deployer,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        algebra,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        deployer,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newBlackholeCL = new BlackholeCL(network, dexKey, dexHelper);

      if (newBlackholeCL.updatePoolState) {
        await newBlackholeCL.updatePoolState();
      }

      const poolLiquidity = await newBlackholeCL.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newBlackholeCL.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});

describe('Supernova', function () {
  const dexKey = 'Supernova';
  let blockNumber: number;
  let supernova: BlackholeCL;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'WETH';
    const deployer = '0xdcfccf2e8c4efbba9127b80eac76c5a122125d29';

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
      supernova = new BlackholeCL(network, dexKey, dexHelper);
      if (supernova.initializePricing) {
        await supernova.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        supernova,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        deployer,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        supernova,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        deployer,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newSupernova = new BlackholeCL(network, dexKey, dexHelper);

      if (newSupernova.updatePoolState) {
        await newSupernova.updatePoolState();
      }

      const poolLiquidity = await newSupernova.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newSupernova.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
