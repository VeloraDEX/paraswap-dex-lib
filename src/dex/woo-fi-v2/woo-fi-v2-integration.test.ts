/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { WooFiV2 } from './woo-fi-v2';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '@paraswap/core';
import { ifaces } from './utils';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  srcTokenAddress: Address,
  destTokenAddress: Address,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      srcTokenAddress,
      destTokenAddress,
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
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  wooFiV2: WooFiV2,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  srcTokenAddress: Address,
  destTokenAddress: Address,
) {
  const exchangeAddress = wooFiV2.config.wooPPV2Address;

  const readerIface = ifaces.PPV2;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    srcTokenAddress,
    destTokenAddress,
  );
  const readerResult = (
    await wooFiV2.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingForPair(
  wooFiV2: WooFiV2,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
  expectNoLiquidity: boolean = false,
) {
  const networkTokens = Tokens[network];

  const pools = await wooFiV2.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  if (expectNoLiquidity) {
    expect(pools.length).toEqual(0);
    return;
  }

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await wooFiV2.getPricesVolume(
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
  if (wooFiV2.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    wooFiV2,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
  );
}

function runTestsForChain(
  dexHelper: DummyDexHelper,
  initProps: { dex: WooFiV2; blockNumber: number },
  baseATokenSymbol: string,
  quoteTokenSymbol: string,
  baseBTokenSymbol: string,
  untradableSymbol: string,
  pricingCheckFuncName: string,
  amountDecimalsDiff: number = 0,
) {
  const network = dexHelper.config.data.network;
  const tokens = Tokens[network];

  it(`getPoolIdentifiers and getPricesVolume SELL: ${baseATokenSymbol} -> ${quoteTokenSymbol}`, async function () {
    const { dex: wooFiV2, blockNumber } = initProps;
    const dexKey = wooFiV2.dexKey;
    const srcTokenSymbol = baseATokenSymbol;
    const destTokenSymbol = quoteTokenSymbol;

    const amountsToTrade = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
    ];

    await testPricingForPair(
      wooFiV2,
      network,
      dexKey,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.SELL,
      amountsToTrade,
      pricingCheckFuncName,
    );
  });

  it(`getPoolIdentifiers and getPricesVolume SELL: ${quoteTokenSymbol} -> ${baseATokenSymbol}`, async function () {
    const { dex: wooFiV2, blockNumber } = initProps;
    const dexKey = wooFiV2.dexKey;
    const srcTokenSymbol = quoteTokenSymbol;
    const destTokenSymbol = baseATokenSymbol;

    const amountsToTrade = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
    ];

    await testPricingForPair(
      wooFiV2,
      network,
      dexKey,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.SELL,
      amountsToTrade,
      pricingCheckFuncName,
    );
  });

  it(`getPoolIdentifiers and getPricesVolume SELL: ${baseATokenSymbol} -> ${baseBTokenSymbol}`, async function () {
    const { dex: wooFiV2, blockNumber } = initProps;
    const dexKey = wooFiV2.dexKey;
    const srcTokenSymbol = baseATokenSymbol;
    const destTokenSymbol = baseBTokenSymbol;

    const amountsToTrade = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
    ];

    await testPricingForPair(
      wooFiV2,
      network,
      dexKey,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.SELL,
      amountsToTrade,
      pricingCheckFuncName,
    );
  });

  it('getPoolIdentifiers and getPricesVolume SELL: No Pool', async function () {
    const { dex: wooFiV2, blockNumber } = initProps;
    const dexKey = wooFiV2.dexKey;
    const srcTokenSymbol = quoteTokenSymbol;
    const destTokenSymbol = untradableSymbol;

    const amountsToTrade = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals - amountDecimalsDiff],
    ];
    await testPricingForPair(
      wooFiV2,
      network,
      dexKey,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.SELL,
      amountsToTrade,
      pricingCheckFuncName,
      true,
    );
  });

  it('getTopPoolsForToken', async function () {
    const { dex: wooFiV2 } = initProps;
    const dexKey = wooFiV2.dexKey;
    // We have to check without calling initializePricing, because
    // pool-tracker is not calling that function
    const newWooFiV2 = new WooFiV2(network, dexKey, dexHelper);
    if (newWooFiV2.updatePoolState) {
      await newWooFiV2.updatePoolState();
    }
    const poolLiquidity = await newWooFiV2.getTopPoolsForToken(
      tokens[quoteTokenSymbol].address,
      10,
    );
    console.log(`${quoteTokenSymbol} Top Pools:`, poolLiquidity);

    if (!newWooFiV2.hasConstantPriceLargeAmounts) {
      checkPoolsLiquidity(
        poolLiquidity,
        Tokens[network][quoteTokenSymbol].address,
        dexKey,
      );
    }
  });
}

describe('WooFiV2', function () {
  const dexKey = 'WooFiV2';
  const pricingCheckFuncName = 'tryQuery';

  describe('Optimism', () => {
    const network = Network.OPTIMISM;
    const dexHelper = new DummyDexHelper(network);
    const initProps: { dex: WooFiV2; blockNumber: number } = {
      dex: new WooFiV2(network, dexKey, dexHelper),
      blockNumber: 0,
    };

    beforeAll(async () => {
      initProps.blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await initProps.dex.initializePricing(initProps.blockNumber);
    });

    const baseATokenSymbol = 'WETH';
    const quoteTokenSymbol = 'USDC';
    const baseBTokenSymbol = 'WBTC';
    const untradableSymbol = 'POPS';

    runTestsForChain(
      dexHelper,
      initProps,
      baseATokenSymbol,
      quoteTokenSymbol,
      baseBTokenSymbol,
      untradableSymbol,
      pricingCheckFuncName,
    );
  });

  describe('BSC', () => {
    const network = Network.BSC;
    const dexHelper = new DummyDexHelper(network);
    const initProps: { dex: WooFiV2; blockNumber: number } = {
      dex: new WooFiV2(network, dexKey, dexHelper),
      blockNumber: 0,
    };

    beforeAll(async () => {
      initProps.blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await initProps.dex.initializePricing(initProps.blockNumber);
    });

    const baseATokenSymbol = 'WBNB';
    const quoteTokenSymbol = 'USDT';
    const baseBTokenSymbol = 'bBTC';
    const untradableSymbol = 'POPS';

    runTestsForChain(
      dexHelper,
      initProps,
      baseATokenSymbol,
      quoteTokenSymbol,
      baseBTokenSymbol,
      untradableSymbol,
      pricingCheckFuncName,
      2,
    );
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);
    const initProps: { dex: WooFiV2; blockNumber: number } = {
      dex: new WooFiV2(network, dexKey, dexHelper),
      blockNumber: 0,
    };

    beforeAll(async () => {
      initProps.blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await initProps.dex.initializePricing(initProps.blockNumber);
    });

    const baseATokenSymbol = 'WMATIC';
    const quoteTokenSymbol = 'USDC';
    const baseBTokenSymbol = 'WETH';
    const untradableSymbol = 'POPS';

    runTestsForChain(
      dexHelper,
      initProps,
      baseATokenSymbol,
      quoteTokenSymbol,
      baseBTokenSymbol,
      untradableSymbol,
      pricingCheckFuncName,
    );
  });

  describe('Sonic', () => {
    const network = Network.SONIC;
    const dexHelper = new DummyDexHelper(network);
    const initProps: { dex: WooFiV2; blockNumber: number } = {
      dex: new WooFiV2(network, dexKey, dexHelper),
      blockNumber: 0,
    };

    beforeAll(async () => {
      initProps.blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await initProps.dex.initializePricing(initProps.blockNumber);
    });

    const baseATokenSymbol = 'WS';
    const quoteTokenSymbol = 'USDCe';
    const baseBTokenSymbol = 'WETH';
    const untradableSymbol = 'BOO';

    runTestsForChain(
      dexHelper,
      initProps,
      baseATokenSymbol,
      quoteTokenSymbol,
      baseBTokenSymbol,
      untradableSymbol,
      pricingCheckFuncName,
    );
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);
    const initProps: { dex: WooFiV2; blockNumber: number } = {
      dex: new WooFiV2(network, dexKey, dexHelper),
      blockNumber: 0,
    };

    beforeAll(async () => {
      initProps.blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await initProps.dex.initializePricing(initProps.blockNumber);
    });

    const baseATokenSymbol = 'WETH';
    const quoteTokenSymbol = 'USDC';
    const baseBTokenSymbol = 'WBTC';
    const untradableSymbol = 'POPS';

    runTestsForChain(
      dexHelper,
      initProps,
      baseATokenSymbol,
      quoteTokenSymbol,
      baseBTokenSymbol,
      untradableSymbol,
      pricingCheckFuncName,
    );
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);
    const initProps: { dex: WooFiV2; blockNumber: number } = {
      dex: new WooFiV2(network, dexKey, dexHelper),
      blockNumber: 0,
    };

    beforeAll(async () => {
      initProps.blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await initProps.dex.initializePricing(initProps.blockNumber);
    });

    const baseATokenSymbol = 'WAVAX';
    const quoteTokenSymbol = 'USDC';
    const baseBTokenSymbol = 'BTCb';
    const untradableSymbol = 'POPS';

    runTestsForChain(
      dexHelper,
      initProps,
      baseATokenSymbol,
      quoteTokenSymbol,
      baseBTokenSymbol,
      untradableSymbol,
      pricingCheckFuncName,
      3,
    );
  });
});
