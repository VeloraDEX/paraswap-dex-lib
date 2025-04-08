/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { UsdcTransmuter } from './usdc-transmuter';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { gnosisChainUsdcTransmuterTokens } from './constants';

/*
  README
  ======

  This test script adds tests for UsdcTransmuter general integration
  with the DEX interface. The test cases below are example tests.
  It is recommended to add tests which cover UsdcTransmuter specific
  logic.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-integration.test.ts`

  (This comment should be removed from the final implementation)
*/

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  // TODO: Put here additional arguments you need
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      // TODO: Put here additional arguments to encode them
      amount,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  // TODO: Adapt this function for your needs
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  usdcTransmuter: UsdcTransmuter,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const exchangeAddress = ''; // TODO: Put here the real exchange address

  // TODO: Replace dummy interface with the real one
  // Normally you can get it from usdcTransmuter.Iface or from eventPool.
  // It depends on your implementation
  const readerIface = new Interface('');

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
  );
  const readerResult = (
    await usdcTransmuter.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  usdcTransmuter: UsdcTransmuter,
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

  const pools = await usdcTransmuter.getPoolIdentifiers(
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

  const poolPrices = await usdcTransmuter.getPricesVolume(
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
  if (usdcTransmuter.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    usdcTransmuter,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

describe('UsdcTransmuter', function () {
  const dexKey = 'UsdcTransmuter';
  let blockNumber: number;
  let usdcTransmuter: UsdcTransmuter;

  describe('Gnosis Chain', () => {
    const network = Network.GNOSIS;
    const dexHelper = new DummyDexHelper(network);

    // Add test tokens to Tokens if they don't exist
    if (!Tokens[network]) {
      Tokens[network] = {};
    }

    if (!Tokens[network]['USDC']) {
      Tokens[network]['USDC'] = {
        address: gnosisChainUsdcTransmuterTokens.USDC.address,
        decimals: gnosisChainUsdcTransmuterTokens.USDC.decimals,
      };
    }

    if (!Tokens[network]['USDCe']) {
      Tokens[network]['USDCe'] = {
        address: gnosisChainUsdcTransmuterTokens.USDCe.address,
        decimals: gnosisChainUsdcTransmuterTokens.USDCe.decimals,
      };
    }

    const tokens = Tokens[network];
    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'USDCe';

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

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      usdcTransmuter = new UsdcTransmuter(network, dexKey, dexHelper);
      if (usdcTransmuter.initializePricing) {
        await usdcTransmuter.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const pools = await usdcTransmuter.getPoolIdentifiers(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await usdcTransmuter.getPricesVolume(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        amountsForSell,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkConstantPoolPrices(poolPrices!, amountsForSell, dexKey);
    });

    it('getTopPoolsForToken', async function () {
      const newUsdcTransmuter = new UsdcTransmuter(network, dexKey, dexHelper);
      if (newUsdcTransmuter.updatePoolState) {
        await newUsdcTransmuter.updatePoolState();
      }
      const poolLiquidity = await newUsdcTransmuter.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(
        poolLiquidity,
        tokens[srcTokenSymbol].address,
        dexKey,
      );
    });
  });
});
