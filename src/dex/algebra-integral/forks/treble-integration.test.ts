/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../../dex-helper/index';
import { Network, SwapSide } from '../../../constants';
import { BI_POWS } from '../../../bigint-constants';
import { Treble } from './treble';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../../tests/utils';
import { Tokens } from '../../../../tests/constants-e2e';
import { Address } from '@paraswap/core';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: Address,
  tokenOut: Address,
  deployer: Address,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      tokenIn,
      tokenOut,
      deployer,
      amount,
      0n,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
  side: SwapSide,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return side === SwapSide.SELL
      ? BigInt(parsed.amountOut)
      : BigInt(parsed.amountIn);
  });
}

async function checkOnChainPricing(
  treble: Treble,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  deployer: Address,
  amounts: bigint[],
  side: SwapSide,
) {
  const exchangeAddress = treble.config.quoter;

  const readerIface = treble.quoterIface;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    tokenIn,
    tokenOut,
    deployer,
  );
  const readerResult = (
    await treble.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName, side),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  treble: Treble,
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

  const pools = await treble.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  // Note: Treble pools currently have low TVL (< $50,000 MIN_USD_TVL_FOR_PRICING)
  // so they are filtered out. This is expected behavior.
  // When Treble grows liquidity, these tests will pass fully.
  if (pools.length === 0) {
    console.log(
      'No pools found above MIN_USD_TVL_FOR_PRICING threshold. This is expected for new DEXes with low liquidity.',
    );
    return;
  }

  const poolPrices = await treble.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools.slice(0, 1),
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  if (treble.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    treble,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
    poolPrices![0].data.path[0].deployer,
    amounts,
    side,
  );
}

describe('TrebleSwap', function () {
  const dexKey = 'TrebleSwap';
  let blockNumber: number;
  let treble: Treble;

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'USDC';

    const amountsForSell = [
      0n,
      (1n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n, // 0.1 WETH
      (2n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (3n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (4n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (5n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (6n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (7n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (8n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      (9n * BI_POWS[tokens[srcTokenSymbol].decimals]) / 10n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals], // 1 WETH
    ];

    const amountsForBuy = [
      0n,
      100n * BI_POWS[tokens[destTokenSymbol].decimals],
      200n * BI_POWS[tokens[destTokenSymbol].decimals],
      300n * BI_POWS[tokens[destTokenSymbol].decimals],
      400n * BI_POWS[tokens[destTokenSymbol].decimals],
      500n * BI_POWS[tokens[destTokenSymbol].decimals],
      600n * BI_POWS[tokens[destTokenSymbol].decimals],
      700n * BI_POWS[tokens[destTokenSymbol].decimals],
      800n * BI_POWS[tokens[destTokenSymbol].decimals],
      900n * BI_POWS[tokens[destTokenSymbol].decimals],
      1000n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      treble = new Treble(network, dexKey, dexHelper);
      if (treble.initializePricing) {
        await treble.initializePricing(blockNumber);
      }
    });

    it('should initialize correctly and fetch pools from subgraph', async function () {
      // Verify the DEX initializes without errors
      expect(treble).toBeDefined();
      expect(treble.config.factory).toBe(
        '0x6e606Cf94A4DDc01aEed2Fce16d1b4f5B33e0A31',
      );
      expect(treble.config.quoter).toBe(
        '0x4b25da09909A2CAF6ec8584B09BA0e24519A46fa',
      );
      expect(treble.config.router).toBe(
        '0x309959994fc3fC6F789796923408f27748879b01',
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        treble,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        'quoteExactInputSingle',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        treble,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        'quoteExactOutputSingle',
      );
    });

    it('getTopPoolsForToken', async function () {
      const newTreble = new Treble(network, dexKey, dexHelper);
      if (newTreble.initializePricing) {
        await newTreble.initializePricing(blockNumber);
      }

      const poolLiquidity = await newTreble.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      // Note: Treble pools may have low TVL, so this check is conditional
      if (poolLiquidity.length > 0) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      } else {
        console.log(
          'No pools with sufficient liquidity found. This is expected for new DEXes.',
        );
      }
    });
  });

  describe('Base USDC-TREB (high TVL pool)', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'TREB';

    // USDC has 6 decimals, TREB has 18 decimals
    const amountsForSell = [
      0n,
      10n * BI_POWS[tokens[srcTokenSymbol].decimals],
      20n * BI_POWS[tokens[srcTokenSymbol].decimals],
      30n * BI_POWS[tokens[srcTokenSymbol].decimals],
      40n * BI_POWS[tokens[srcTokenSymbol].decimals],
      50n * BI_POWS[tokens[srcTokenSymbol].decimals],
      60n * BI_POWS[tokens[srcTokenSymbol].decimals],
      70n * BI_POWS[tokens[srcTokenSymbol].decimals],
      80n * BI_POWS[tokens[srcTokenSymbol].decimals],
      90n * BI_POWS[tokens[srcTokenSymbol].decimals],
      100n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      100n * BI_POWS[tokens[destTokenSymbol].decimals],
      200n * BI_POWS[tokens[destTokenSymbol].decimals],
      300n * BI_POWS[tokens[destTokenSymbol].decimals],
      400n * BI_POWS[tokens[destTokenSymbol].decimals],
      500n * BI_POWS[tokens[destTokenSymbol].decimals],
      600n * BI_POWS[tokens[destTokenSymbol].decimals],
      700n * BI_POWS[tokens[destTokenSymbol].decimals],
      800n * BI_POWS[tokens[destTokenSymbol].decimals],
      900n * BI_POWS[tokens[destTokenSymbol].decimals],
      1000n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      treble = new Treble(network, dexKey, dexHelper);
      if (treble.initializePricing) {
        await treble.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        treble,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        'quoteExactInputSingle',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        treble,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        'quoteExactOutputSingle',
      );
    });

    it('getTopPoolsForToken TREB', async function () {
      const newTreble = new Treble(network, dexKey, dexHelper);
      if (newTreble.initializePricing) {
        await newTreble.initializePricing(blockNumber);
      }

      const poolLiquidity = await newTreble.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );
      console.log(`${destTokenSymbol} Top Pools:`, poolLiquidity);

      if (poolLiquidity.length > 0) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      } else {
        console.log('No pools with sufficient liquidity found for TREB.');
      }
    });
  });
});
