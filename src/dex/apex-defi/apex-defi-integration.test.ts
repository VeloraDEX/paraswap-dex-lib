/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { ApexDefi } from './apex-defi';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '@paraswap/core';
import { ApexDefiConfig } from './config';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: Address,
  tokenOut: Address,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      amount, // amountIn
      [tokenIn, tokenOut], // path array
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
    const amounts = parsed[0] as any[];

    // For getAmountsIn, we want the first amount (input amount needed)
    // For getAmountsOut, we want the last amount (output amount received)
    if (funcName === 'getAmountsIn') {
      return BigInt(amounts[0]._hex);
    } else {
      return BigInt(amounts[amounts.length - 1]._hex);
    }
  });
}

async function checkOnChainPricing(
  apexDefi: ApexDefi,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  tokenIn: Address,
  tokenOut: Address,
) {
  const exchangeAddress =
    ApexDefiConfig.ApexDefi[apexDefi.network].routerAddress;

  const readerIface = apexDefi.routerIface;

  // ✅ Convert only for router calls
  const routerPath = apexDefi.fixPathForRouter([tokenIn, tokenOut]);

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    routerPath[0], // Use WAVAX for router
    routerPath[1], // Use WAVAX for router
  );
  const readerResult = (
    await apexDefi.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  apexDefi: ApexDefi,
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

  const pools = await apexDefi.getPoolIdentifiers(
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

  const poolPrices = await apexDefi.getPricesVolume(
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
  if (apexDefi.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    apexDefi,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
  );
}

// Helper to get amounts array for a token symbol
function getAmountsForToken(symbol: string, decimals: number): bigint[] {
  // Use smaller amounts for BTC-like tokens
  if (symbol.toLowerCase().includes('btc')) {
    // 0, 0.0001, 0.0002, ..., 0.001 BTC
    return Array.from(
      { length: 11 },
      (_, i) => BigInt(i) * 10n ** BigInt(decimals - 4),
    );
  }
  // Default: 0, 1, 2, ..., 10 units
  return Array.from(
    { length: 11 },
    (_, i) => BigInt(i) * 10n ** BigInt(decimals),
  );
}

// Token pair configuration for testing
interface TokenPairTestConfig {
  srcTokenSymbol: string;
  destTokenSymbol: string;
  description?: string;
}

describe('ApexDefi', function () {
  const dexKey = 'ApexDefi';
  let blockNumber: number;
  let apexDefi: ApexDefi;

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    // Define all token pairs to test
    const tokenPairsToTest: TokenPairTestConfig[] = [
      {
        srcTokenSymbol: 'AVAX',
        destTokenSymbol: 'APEX',
        description: 'AVAX to APEX',
      },
      {
        srcTokenSymbol: 'AVAX',
        destTokenSymbol: 'aUSDC',
        description: 'AVAX to aUSDC',
      },
      {
        srcTokenSymbol: 'AVAX',
        destTokenSymbol: 'aBTCb',
        description: 'AVAX to aBTCb',
      },
      {
        srcTokenSymbol: 'AVAX',
        destTokenSymbol: 'BTCb',
        description: 'AVAX to BTCb',
      },
      // {
      //   srcTokenSymbol: 'APEX',
      //   destTokenSymbol: 'aBTCb',
      //   description: 'APEX to aBTCb',
      // },
      // {
      //   srcTokenSymbol: 'aBTCb',
      //   destTokenSymbol: 'APEX',
      //   description: 'aBTCb to APEX',
      // },
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      console.log('blockNumber', blockNumber);
      apexDefi = new ApexDefi(network, dexKey, dexHelper);
      if (apexDefi.initializePricing) {
        await apexDefi.initializePricing(blockNumber);
      }
    });

    // Test each token pair
    tokenPairsToTest.forEach((pairConfig: TokenPairTestConfig) => {
      const { srcTokenSymbol, destTokenSymbol, description } = pairConfig;
      const testDescription =
        description || `${srcTokenSymbol} <> ${destTokenSymbol}`;

      describe(testDescription, () => {
        const srcDecimals = tokens[srcTokenSymbol].decimals;
        const destDecimals = tokens[destTokenSymbol].decimals;

        const amountsForSell = getAmountsForToken(srcTokenSymbol, srcDecimals);
        const amountsForBuy = getAmountsForToken(destTokenSymbol, destDecimals);

        it('getPoolIdentifiers and getPricesVolume SELL', async function () {
          await testPricingOnNetwork(
            apexDefi,
            network,
            dexKey,
            blockNumber,
            srcTokenSymbol,
            destTokenSymbol,
            SwapSide.SELL,
            amountsForSell,
            'getAmountsOut',
          );
        });

        it('getPoolIdentifiers and getPricesVolume BUY', async function () {
          await testPricingOnNetwork(
            apexDefi,
            network,
            dexKey,
            blockNumber,
            srcTokenSymbol,
            destTokenSymbol,
            SwapSide.BUY,
            amountsForBuy,
            'getAmountsIn',
          );
        });
      });
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newApexDefi = new ApexDefi(network, dexKey, dexHelper);
      if (newApexDefi.updatePoolState) {
        await newApexDefi.updatePoolState();
      }
      const poolLiquidity = await newApexDefi.getTopPoolsForToken(
        tokens.AVAX.address,
        10,
      );
      console.log(`AVAX Top Pools:`, poolLiquidity);

      if (!newApexDefi.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network].AVAX.address,
          dexKey,
        );
      }
    });
  });
});
