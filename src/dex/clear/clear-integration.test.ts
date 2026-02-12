/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Clear } from './clear';
import { ClearConfig } from './config';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import clearSwapAbi from '../../abi/clear/ClearSwap.json';

/*
  Clear Integration Tests

  Clear is a depeg arbitrage protocol - swaps only yield prices when
  stablecoins are depegged (>0.05% difference). Tests handle both
  depeg and no-depeg market conditions gracefully.

  Run with:
  `npx jest src/dex/clear/clear-integration.test.ts`
*/

const clearSwapIface = new Interface(clearSwapAbi);

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  vaultAddress: string,
  srcToken: string,
  destToken: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      vaultAddress,
      srcToken,
      destToken,
      amount,
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
    return BigInt(parsed.amountOut.toString());
  });
}

async function checkOnChainPricing(
  dexKey: string,
  network: Network,
  clear: Clear,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  vaultAddress: string,
  srcToken: string,
  destToken: string,
) {
  const exchangeAddress = ClearConfig[dexKey][network].swapAddress;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    clearSwapIface,
    amounts.slice(1),
    funcName,
    vaultAddress,
    srcToken,
    destToken,
  );

  const readerResult = (
    await clear.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, clearSwapIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  clear: Clear,
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

  const pools = await clear.getPoolIdentifiers(
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

  const poolPrices = await clear.getPricesVolume(
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

  // Clear is depeg-dependent: null means no depeg exists
  if (poolPrices === null) {
    console.log(
      'No depeg detected - prices are null (expected for stable market)',
    );
    return;
  }

  expect(poolPrices).not.toBeNull();
  checkPoolPrices(poolPrices!, amounts, side, dexKey);

  // Check if on-chain pricing equals calculated ones
  const vaultAddress = pools[0].split('_')[1];
  await checkOnChainPricing(
    dexKey,
    network,
    clear,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    vaultAddress,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
  );
}

describe('Clear', function () {
  const dexKey = 'Clear';
  let blockNumber: number;
  let clear: Clear;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'GHO';

    const buildAmounts = (decimals: number) => [
      0n,
      1n * BI_POWS[decimals],
      2n * BI_POWS[decimals],
      3n * BI_POWS[decimals],
      4n * BI_POWS[decimals],
      5n * BI_POWS[decimals],
      6n * BI_POWS[decimals],
      7n * BI_POWS[decimals],
      8n * BI_POWS[decimals],
      9n * BI_POWS[decimals],
      10n * BI_POWS[decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      clear = new Clear(network, dexKey, dexHelper);
      if (clear.initializePricing) {
        await clear.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        clear,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        buildAmounts(tokens[srcTokenSymbol].decimals),
        'previewSwap',
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL reverse', async function () {
      await testPricingOnNetwork(
        clear,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.SELL,
        buildAmounts(tokens[destTokenSymbol].decimals),
        'previewSwap',
      );
    });

    it('BUY side should return null (not supported)', async function () {
      const poolPrices = await clear.getPricesVolume(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        buildAmounts(tokens[destTokenSymbol].decimals),
        SwapSide.BUY,
        blockNumber,
      );

      expect(poolPrices).toBeNull();
    });

    it('should return empty for unsupported pair', async function () {
      const pools = await clear.getPoolIdentifiers(
        tokens['WETH'],
        tokens['DAI'],
        SwapSide.SELL,
        blockNumber,
      );

      expect(pools.length).toBe(0);
    });

    it('getTopPoolsForToken', async function () {
      const newClear = new Clear(network, dexKey, dexHelper);
      if (newClear.updatePoolState) {
        await newClear.updatePoolState();
      }
      const poolLiquidity = await newClear.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newClear.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
