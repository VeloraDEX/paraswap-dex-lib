/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { BunniV2 } from './bunni-v2';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { PoolKey } from './types';
import { BunniV2Config } from './config';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  poolKey: PoolKey,
  zeroForOne: boolean,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      {
        poolKey,
        zeroForOne,
        exactAmount: amount,
        hookData: '0x',
      },
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  bunniV2: BunniV2,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  poolKey: PoolKey,
  zeroForOne: boolean,
  side: SwapSide,
  amounts: bigint[],
) {
  const exchangeAddress = BunniV2Config.BunniV2[bunniV2.network].quoter;
  const readerIface = bunniV2.quoterInterface;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    poolKey,
    zeroForOne,
  );
  const readerResult = (
    await bunniV2.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  // accept deviations of +/- 0.01% from on chain pricing
  for (let i = 0; i < prices.length; i++) {
    if (side === SwapSide.SELL)
      expect(prices[i]).toBeGreaterThanOrEqual(
        (expectedPrices[i] * 9999n) / 10000n,
      );
    else
      expect(prices[i]).toBeLessThanOrEqual(
        (expectedPrices[i] * 10001n) / 10000n,
      );
  }
}

async function testPricingOnNetwork(
  bunniV2: BunniV2,
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

  const pools = await bunniV2.getPoolIdentifiers(
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

  const poolPrices = await bunniV2.getPricesVolume(
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
  if (bunniV2.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey, false);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    bunniV2,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    poolPrices![0].data.path[0].pool.key,
    poolPrices![0].data.path[0].zeroForOne,
    side,
    amounts,
  );
}

describe('BunniV2', function () {
  const dexKey = 'BunniV2';
  let blockNumber: number;
  let bunniV2: BunniV2;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    describe('USDC-USDT', () => {
      const srcTokenSymbol = 'USDC';
      const destTokenSymbol = 'USDT';

      const amountsForSell = (
        srcTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (2n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (3n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (4n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (5n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (6n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (7n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (8n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (9n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (10n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      const amountsForBuy = (
        destTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (2n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (3n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (4n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (5n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (6n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (7n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (8n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (9n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (10n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        bunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (bunniV2.initializePricing) {
          await bunniV2.initializePricing(blockNumber);
        }
      });

      afterAll(async () => {
        if (bunniV2.releaseResources) {
          bunniV2.releaseResources();
        }
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell(srcTokenSymbol, 100n, 1n),
          'quoteExactInputSingle',
        );
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(destTokenSymbol, 100n, 1n),
          'quoteExactOutputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.SELL,
          amountsForSell(destTokenSymbol, 100n, 1n),
          'quoteExactInputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(srcTokenSymbol, 100n, 1n),
          'quoteExactOutputSingle',
        );
      });

      it(`${srcTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });

      it(`${destTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[destTokenSymbol].address,
          10,
        );
        console.log(`${destTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][destTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('USD0-USD0++', () => {
      const srcTokenSymbol = 'USD0';
      const destTokenSymbol = 'USD0++';

      const amountsForSell = (
        srcTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (2n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (3n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (4n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (5n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (6n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (7n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (8n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (9n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (10n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      const amountsForBuy = (
        destTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (2n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (3n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (4n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (5n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (6n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (7n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (8n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (9n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (10n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        bunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (bunniV2.initializePricing) {
          await bunniV2.initializePricing(blockNumber);
        }
      });

      afterAll(async () => {
        if (bunniV2.releaseResources) {
          bunniV2.releaseResources();
        }
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell(srcTokenSymbol, 10n, 1n),
          'quoteExactInputSingle',
        );
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(destTokenSymbol, 10n, 1n),
          'quoteExactOutputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.SELL,
          amountsForSell(destTokenSymbol, 10n, 1n),
          'quoteExactInputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(srcTokenSymbol, 10n, 1n),
          'quoteExactOutputSingle',
        );
      });

      it(`${srcTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });

      it(`${destTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[destTokenSymbol].address,
          10,
        );
        console.log(`${destTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][destTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    describe('USND-USDC', () => {
      const srcTokenSymbol = 'USND';
      const destTokenSymbol = 'USDC';

      const amountsForSell = (
        srcTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (2n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (3n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (4n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (5n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (6n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (7n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (8n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (9n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (10n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      const amountsForBuy = (
        destTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (2n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (3n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (4n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (5n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (6n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (7n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (8n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (9n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (10n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        bunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (bunniV2.initializePricing) {
          await bunniV2.initializePricing(blockNumber);
        }
      });

      afterAll(async () => {
        if (bunniV2.releaseResources) {
          bunniV2.releaseResources();
        }
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell(srcTokenSymbol, 10n, 1n),
          'quoteExactInputSingle',
        );
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(destTokenSymbol, 10n, 1n),
          'quoteExactOutputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.SELL,
          amountsForSell(destTokenSymbol, 10n, 1n),
          'quoteExactInputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(srcTokenSymbol, 10n, 1n),
          'quoteExactOutputSingle',
        );
      });

      it(`${srcTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });

      it(`${destTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[destTokenSymbol].address,
          10,
        );
        console.log(`${destTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][destTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    describe('ETH-USDC', () => {
      const srcTokenSymbol = 'ETH';
      const destTokenSymbol = 'USDC';

      const amountsForSell = (
        srcTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (2n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (3n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (4n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (5n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (6n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (7n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (8n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (9n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (10n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      const amountsForBuy = (
        destTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (2n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (3n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (4n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (5n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (6n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (7n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (8n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (9n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (10n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        bunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (bunniV2.initializePricing) {
          await bunniV2.initializePricing(blockNumber);
        }
      });

      afterAll(async () => {
        if (bunniV2.releaseResources) {
          bunniV2.releaseResources();
        }
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell(srcTokenSymbol, 1n, 10n),
          'quoteExactInputSingle',
        );
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(destTokenSymbol, 1n, 10n),
          'quoteExactOutputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.SELL,
          amountsForSell(destTokenSymbol, 1n, 10n),
          'quoteExactInputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(srcTokenSymbol, 1n, 10n),
          'quoteExactOutputSingle',
        );
      });

      it(`${srcTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });

      it(`${destTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[destTokenSymbol].address,
          10,
        );
        console.log(`${destTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][destTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('UNICHAIN', () => {
    const network = Network.UNICHAIN;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    describe('ETH-weETH', () => {
      const srcTokenSymbol = 'ETH';
      const destTokenSymbol = 'weETH';

      const amountsForSell = (
        srcTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (2n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (3n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (4n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (5n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (6n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (7n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (8n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (9n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) / scaleDown,
          (10n * BI_POWS[tokens[srcTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      const amountsForBuy = (
        destTokenSymbol: string,
        scaleUp: bigint = 1n,
        scaleDown: bigint = 1n,
      ) => {
        return [
          0n,
          (1n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (2n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (3n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (4n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (5n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (6n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (7n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (8n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (9n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
          (10n * BI_POWS[tokens[destTokenSymbol].decimals] * scaleUp) /
            scaleDown,
        ];
      };

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        bunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (bunniV2.initializePricing) {
          await bunniV2.initializePricing(blockNumber);
        }
      });

      afterAll(async () => {
        if (bunniV2.releaseResources) {
          bunniV2.releaseResources();
        }
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell(srcTokenSymbol),
          'quoteExactInputSingle',
        );
      });

      it(`${srcTokenSymbol} -> ${destTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(destTokenSymbol),
          'quoteExactOutputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.SELL,
          amountsForSell(destTokenSymbol),
          'quoteExactInputSingle',
        );
      });

      it(`${destTokenSymbol} -> ${srcTokenSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
        await testPricingOnNetwork(
          bunniV2,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.BUY,
          amountsForBuy(srcTokenSymbol),
          'quoteExactOutputSingle',
        );
      });

      it(`${srcTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });

      it(`${destTokenSymbol} getTopPoolsForToken`, async function () {
        const newBunniV2 = new BunniV2(network, dexKey, dexHelper);
        if (newBunniV2.updatePoolState) {
          await newBunniV2.updatePoolState();
        }
        const poolLiquidity = await newBunniV2.getTopPoolsForToken(
          tokens[destTokenSymbol].address,
          10,
        );
        console.log(`${destTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newBunniV2.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][destTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });
});
