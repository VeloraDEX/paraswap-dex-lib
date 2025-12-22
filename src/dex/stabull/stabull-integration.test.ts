/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Stabull } from './stabull';
import { checkPoolPrices, checkConstantPoolPrices } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import routerABI from '../../abi/stabull/stabull-router.json';

// Define router addresses for different networks with proper type
const STABULL_ROUTERS: Record<number, string> = {
  [Network.POLYGON]: '0x0C1F53e7b5a770f4C0d4bEF139F752EEb08de88d',
  [Network.MAINNET]: '0x871af97122D08890193e8D6465015f6D9e2889b2',
};

// Define quote currencies for different networks with proper type
const QUOTE_CURRENCIES: Record<number, string> = {
  [Network.POLYGON]: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDCn on Polygon
  [Network.MAINNET]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
};

/**
 * Gets the quote currency address for the given network
 */
function getQuoteCurrency(network: Network): string {
  const quoteCurrency = QUOTE_CURRENCIES[network as number];
  if (!quoteCurrency) {
    throw new Error(`No quote currency configured for network ${network}`);
  }
  return quoteCurrency;
}

/**
 * Gets the router address for the given network
 */
function getRouterAddress(network: Network): string {
  const address = STABULL_ROUTERS[network as number];
  if (!address) {
    throw new Error(
      `No Stabull router address configured for network ${network}`,
    );
  }
  return address;
}

/**
 * Creates calldata for viewOriginSwap (SELL) operations
 */
function getOriginSwapReaderCalldata(
  routerAddress: string,
  readerIface: Interface,
  quoteCurrency: string,
  srcToken: string,
  destToken: string,
  amounts: bigint[],
) {
  return amounts.map(amount => {
    const callData = readerIface.encodeFunctionData('viewOriginSwap', [
      quoteCurrency,
      srcToken,
      destToken,
      amount.toString(),
    ]);
    return {
      target: routerAddress,
      callData: callData,
    };
  });
}

/**
 * Creates calldata for viewTargetSwap (BUY) operations
 */
function getTargetSwapReaderCalldata(
  routerAddress: string,
  readerIface: Interface,
  quoteCurrency: string,
  srcToken: string,
  destToken: string,
  amounts: bigint[],
) {
  return amounts.map(amount => {
    const callData = readerIface.encodeFunctionData('viewTargetSwap', [
      quoteCurrency,
      srcToken,
      destToken,
      amount.toString(),
    ]);
    return {
      target: routerAddress,
      callData: callData,
    };
  });
}

/**
 * Creates calldata for price checks based on swap side
 */
function getReaderCalldata(
  network: Network,
  readerIface: Interface,
  srcToken: string,
  destToken: string,
  amounts: bigint[],
  side: SwapSide,
) {
  // Skip the first amount which is 0
  const relevantAmounts = amounts.slice(1);
  const routerAddress = getRouterAddress(network);
  const quoteCurrency = getQuoteCurrency(network);

  if (side === SwapSide.SELL) {
    return getOriginSwapReaderCalldata(
      routerAddress,
      readerIface,
      quoteCurrency,
      srcToken,
      destToken,
      relevantAmounts,
    );
  } else {
    return getTargetSwapReaderCalldata(
      routerAddress,
      readerIface,
      quoteCurrency,
      srcToken,
      destToken,
      relevantAmounts,
    );
  }
}

/**
 * Decodes contract call results into BigInt values
 */
function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
): bigint[] {
  return results.map(result => {
    try {
      if (
        Array.isArray(result) &&
        result[0] &&
        typeof result[0] === 'object' &&
        result[0]._hex
      ) {
        return BigInt(result[0]._hex);
      }

      // For viewTargetSwap, extract originAmount_
      if (
        funcName === 'viewTargetSwap' &&
        result &&
        result.originAmount_ &&
        result.originAmount_._hex
      ) {
        return BigInt(result.originAmount_._hex);
      }

      // For viewOriginSwap, extract targetAmount_
      if (
        funcName === 'viewOriginSwap' &&
        result &&
        result.targetAmount_ &&
        result.targetAmount_._hex
      ) {
        return BigInt(result.targetAmount_._hex);
      }

      // Handle other potential result formats
      if (typeof result === 'object' && result._hex) {
        return BigInt(result._hex);
      }

      console.log('Result structure:', JSON.stringify(result, null, 2));
      return 0n;
    } catch (error) {
      console.error('Error extracting value from result:', error);
      console.log(
        'Result that failed to process:',
        JSON.stringify(result, null, 2),
      );
      return 0n;
    }
  });
}

/**
 * Makes on-chain calls to verify pricing from the contract
 */
async function checkOnChainPricing(
  stabull: Stabull,
  network: Network,
  side: SwapSide,
  srcToken: string,
  destToken: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  // Determine function name based on swap side
  const funcName = side === SwapSide.SELL ? 'viewOriginSwap' : 'viewTargetSwap';
  const readerIface = new Interface(routerABI);

  const readerCallData = getReaderCalldata(
    network,
    readerIface,
    srcToken,
    destToken,
    amounts,
    side,
  );

  console.log('Reader call data:', readerCallData);
  const results: string[] = [];

  // Make individual calls
  for (const call of readerCallData) {
    try {
      const result = await stabull.dexHelper.web3Provider.eth.call(
        {
          to: call.target,
          data: call.callData,
        },
        blockNumber,
      );
      console.log(`Result for call to ${call.target}:`, result);
      results.push(result);
    } catch (error) {
      console.error(`Failed call to ${call.target}:`, error);
      console.error(error);
    }
  }

  // Decode results
  const decodedResults = results
    .map((result, index) => {
      if (!result) {
        console.error(`Result ${index} is undefined or empty`);
        return null;
      }
      try {
        return readerIface.decodeFunctionResult(funcName, result);
      } catch (error) {
        console.error(`Failed to decode result ${index}:`, error);
        return null;
      }
    })
    .filter((result): result is Result => result !== null);

  // Add a 0n at the beginning to match our amounts array that starts with 0
  const expectedPrices = [0n].concat(
    decodeReaderResult(decodedResults, readerIface, funcName),
  );

  console.log('Expected prices:', expectedPrices);
  expect(prices).toEqual(expectedPrices);
}

/**
 * Tests pricing functionality for a specific token pair on a network
 */
async function testPricingOnNetwork(
  stabull: Stabull,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];
  const srcToken = networkTokens[srcTokenSymbol];
  const destToken = networkTokens[destTokenSymbol];

  if (!srcToken || !destToken) {
    throw new Error(
      `Token not found: ${!srcToken ? srcTokenSymbol : destTokenSymbol}`,
    );
  }

  const pools = await stabull.getPoolIdentifiers(
    srcToken,
    destToken,
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await stabull.getPricesVolume(
    srcToken,
    destToken,
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
  if (stabull.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals the calculated ones
  await checkOnChainPricing(
    stabull,
    network,
    side,
    srcToken.address,
    destToken.address,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

describe('Stabull', () => {
  const dexKey = 'Stabull';

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    // Token pairs for Polygon tests
    const srcTokenSymbol = 'USDT';
    const destTokenSymbol = 'NZDS';
    const srcTokenSymbol2 = 'USDCn';

    let blockNumber: number;
    let stabull: Stabull;

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      stabull = new Stabull(network, dexKey, dexHelper);
    });

    describe('Direct Swap - SELL (USDT to USDCn)', () => {
      it('should return valid pool identifiers and prices for SELL', async () => {
        const amountsForSell = [
          0n,
          1n * BI_POWS[tokens[srcTokenSymbol].decimals],
          2n * BI_POWS[tokens[srcTokenSymbol].decimals],
          3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        ];

        await testPricingOnNetwork(
          stabull,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          srcTokenSymbol2,
          SwapSide.SELL,
          amountsForSell,
        );
      });
    });

    describe('Indirect Swap - BUY (USDT to NZDS)', () => {
      it('should return valid pool identifiers and prices for BUY', async () => {
        const amountsForBuy = [
          0n,
          1n * BI_POWS[tokens[destTokenSymbol].decimals],
          2n * BI_POWS[tokens[destTokenSymbol].decimals],
          3n * BI_POWS[tokens[destTokenSymbol].decimals],
        ];

        await testPricingOnNetwork(
          stabull,
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

  describe('Ethereum', () => {
    const network = Network.MAINNET;
    const hasMainnetTokens =
      !!Tokens[network] && Object.keys(Tokens[network]).length > 0;

    if (!hasMainnetTokens) {
      it('Skip Ethereum tests - no tokens defined', () => {
        console.log('Skipping Ethereum tests as no tokens are defined');
      });
      return;
    }

    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    // Token pairs for Ethereum tests
    const srcTokenSymbol = 'EURS';
    const destTokenSymbol = 'NZDS';
    const srcTokenSymbol2 = 'USDC';

    let localBlockNumber: number;
    let localStabull: Stabull;

    beforeAll(async () => {
      try {
        localBlockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        localStabull = new Stabull(network, dexKey, dexHelper);
      } catch (error) {
        console.error('Error setting up Ethereum tests:', error);
      }
    });

    describe('Direct Swap - SELL (EURS to USDC)', () => {
      it('should return valid pool identifiers and prices for SELL', async () => {
        if (!tokens[srcTokenSymbol] || !tokens[srcTokenSymbol2]) {
          console.log(
            `Skipping test: tokens not found (${srcTokenSymbol}, ${srcTokenSymbol2})`,
          );
          return;
        }

        const amountsForSell = [
          0n,
          1n * BI_POWS[tokens[srcTokenSymbol].decimals],
          2n * BI_POWS[tokens[srcTokenSymbol].decimals],
          3n * BI_POWS[tokens[srcTokenSymbol].decimals],
        ];

        await testPricingOnNetwork(
          localStabull,
          network,
          dexKey,
          localBlockNumber,
          srcTokenSymbol,
          srcTokenSymbol2,
          SwapSide.SELL,
          amountsForSell,
        );
      });
    });

    describe('Indirect Swap - BUY (EURS to NZDS)', () => {
      it('should return valid pool identifiers and prices for BUY', async () => {
        const amountsForBuy = [
          0n,
          1n * BI_POWS[tokens[destTokenSymbol].decimals],
        ];

        await testPricingOnNetwork(
          localStabull,
          network,
          dexKey,
          localBlockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
        );
      });
    });
  });
});
