/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import PancakeswapV3QuoterABI from '../../abi/pancakeswap-v3/PancakeswapV3Quoter.abi.json';
import { Address } from '@paraswap/core';
import { PancakeswapV3 } from './pancakeswap-v3';
import * as net from 'net';

const networks = [Network.MAINNET, Network.BSC];

const dexKey = 'PancakeswapV3';

const quoterIface = new Interface(PancakeswapV3QuoterABI);

const testingData: Partial<{ [key in Network]: any }> = {
  [Network.MAINNET]: {
    tokenA: Tokens[Network.MAINNET]['WBTC'],
    tokenASymbol: 'WBTC',
    stableA: Tokens[Network.MAINNET]['USDC'],
    stableASymbol: 'USDC',
    tokenB: Tokens[Network.MAINNET]['WETH'],
    tokenBSymbol: 'WETH',
    stableB: Tokens[Network.MAINNET]['USDT'],
    stableBSymbol: 'USDT',
    stableSellAmounts: [
      0n,
      10_000n * BI_POWS[6],
      20_000n * BI_POWS[6],
      30_000n * BI_POWS[6],
    ],
    stableBuyAmounts: [0n, 1n * BI_POWS[6], 2n * BI_POWS[6], 3n * BI_POWS[6]],
    regularSellAmounts: [0n, 1n * BI_POWS[8], 2n * BI_POWS[8], 3n * BI_POWS[8]],
    regularBuyAmounts: [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
    ],
  },
  [Network.BSC]: {
    tokenA: Tokens[Network.BSC]['bBTC'],
    tokenASymbol: 'bBTC',
    stableA: Tokens[Network.BSC]['USDC'],
    stableASymbol: 'USDC',
    tokenB: Tokens[Network.BSC]['WBNB'],
    tokenBSymbol: 'WBNB',
    stableB: Tokens[Network.BSC]['USDT'],
    stableBSymbol: 'USDT',
    stableSellAmounts: [
      0n,
      10_000n * BI_POWS[6],
      20_000n * BI_POWS[6],
      30_000n * BI_POWS[6],
    ],
    stableBuyAmounts: [0n, 1n * BI_POWS[6], 2n * BI_POWS[6], 3n * BI_POWS[6]],
    regularSellAmounts: [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
    ],
    regularBuyAmounts: [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
    ],
  },
};

describe('PancakeswapV3', function () {
  describe('BSC', () => {
    describe('WBNB -> USDT', () => {
      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        const network = Network.BSC;
        const dexHelper = new DummyDexHelper(network);
        const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        const pancakeswapV3 = new PancakeswapV3(network, dexKey, dexHelper);

        const WBNB = Tokens[network]['WBNB'];
        const USDT = Tokens[network]['USDT'];

        const amounts = [0n, 1n * BI_POWS[18], 2n * BI_POWS[18]];

        const pools = await pancakeswapV3.getPoolIdentifiers(
          WBNB,
          USDT,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(`WBNB <> USDT Pool Identifiers: `, pools);

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await pancakeswapV3.getPricesVolume(
          WBNB,
          USDT,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(`WBNB <> USDT Pool Prices: `, poolPrices);

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(
          poolPrices!.filter(pp => pp.unit !== 0n),
          amounts,
          SwapSide.SELL,
          dexKey,
        );

        // Check if onchain pricing equals to calculated ones
        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const fee =
              pancakeswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
            const res = await checkOnChainPricing(
              pancakeswapV3,
              dexHelper,
              'quoteExactInputSingle',
              blockNumber,
              price.prices,
              WBNB.address,
              USDT.address,
              fee,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );
        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });
    });
  });

  networks.forEach(network =>
    describe(network, function () {
      let blockNumber: number;
      let pancakeswapV3: PancakeswapV3;
      const testData = testingData[network];
      if (testData) {
        const {
          stableA,
          stableASymbol,
          stableB,
          stableBSymbol,
          stableSellAmounts,
          stableBuyAmounts,
          tokenA,
          tokenASymbol,
          tokenB,
          tokenBSymbol,
          regularSellAmounts,
          regularBuyAmounts,
        } = testData;
        const dexHelper = new DummyDexHelper(network);

        beforeEach(async () => {
          blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
          pancakeswapV3 = new PancakeswapV3(network, dexKey, dexHelper);
        });

        describe('Stable pairs', function () {
          it('getPoolIdentifiers and getPricesVolume SELL stable pairs', async function () {
            const pools = await pancakeswapV3.getPoolIdentifiers(
              stableA,
              stableB,
              SwapSide.SELL,
              blockNumber,
            );
            console.log(
              `${stableASymbol} <> ${stableBSymbol} Pool Identifiers: `,
              pools,
            );

            expect(pools.length).toBeGreaterThan(0);

            const poolPrices = await pancakeswapV3.getPricesVolume(
              stableA,
              stableB,
              stableSellAmounts,
              SwapSide.SELL,
              blockNumber,
              pools,
            );
            console.log(
              `${stableASymbol} <> ${stableBSymbol} Pool Prices: `,
              poolPrices,
            );

            expect(poolPrices).not.toBeNull();
            checkPoolPrices(
              poolPrices!.filter(pp => pp.unit !== 0n),
              stableSellAmounts,
              SwapSide.SELL,
              dexKey,
            );

            // Check if onchain pricing equals to calculated ones
            let falseChecksCounter = 0;
            await Promise.all(
              poolPrices!.map(async price => {
                const fee =
                  pancakeswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
                const res = await checkOnChainPricing(
                  pancakeswapV3,
                  dexHelper,
                  'quoteExactInputSingle',
                  blockNumber,
                  price.prices,
                  stableA.address,
                  stableB.address,
                  fee,
                  stableSellAmounts,
                );
                if (res === false) falseChecksCounter++;
              }),
            );
            expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
          });

          it('getPoolIdentifiers and getPricesVolume BUY stable pairs', async function () {
            const pools = await pancakeswapV3.getPoolIdentifiers(
              stableA,
              stableB,
              SwapSide.BUY,
              blockNumber,
            );
            console.log(
              `${stableASymbol} <> ${stableBSymbol} Pool Identifiers: `,
              pools,
            );

            expect(pools.length).toBeGreaterThan(0);

            const poolPrices = await pancakeswapV3.getPricesVolume(
              stableA,
              stableB,
              stableBuyAmounts,
              SwapSide.BUY,
              blockNumber,
              pools,
            );
            console.log(
              `${stableASymbol} <> ${stableBSymbol} Pool Prices: `,
              poolPrices,
            );

            expect(poolPrices).not.toBeNull();
            checkPoolPrices(
              poolPrices!.filter(pp => pp.unit !== 0n),
              stableBuyAmounts,
              SwapSide.BUY,
              dexKey,
            );

            // Check if onchain pricing equals to calculated ones
            let falseChecksCounter = 0;
            await Promise.all(
              poolPrices!.map(async price => {
                const fee =
                  pancakeswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
                const res = await checkOnChainPricing(
                  pancakeswapV3,
                  dexHelper,
                  'quoteExactOutputSingle',
                  blockNumber,
                  price.prices,
                  stableA.address,
                  stableB.address,
                  fee,
                  stableBuyAmounts,
                );
                if (res === false) falseChecksCounter++;
              }),
            );
            expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
          });

          it('getTopPoolsForToken', async function () {
            const poolLiquidity = await pancakeswapV3.getTopPoolsForToken(
              stableA.address,
              10,
            );
            console.log(`${stableASymbol} Top Pools:`, poolLiquidity);

            if (!pancakeswapV3.hasConstantPriceLargeAmounts) {
              checkPoolsLiquidity(poolLiquidity, stableA.address, dexKey);
            }
          });
        });

        describe('Regular pairs', function () {
          it('getPoolIdentifiers and getPricesVolume SELL', async function () {
            const pools = await pancakeswapV3.getPoolIdentifiers(
              tokenA,
              tokenB,
              SwapSide.SELL,
              blockNumber,
            );
            console.log(
              `${tokenASymbol} <> ${tokenBSymbol} Pool Identifiers: `,
              pools,
            );

            expect(pools.length).toBeGreaterThan(0);

            const poolPrices = await pancakeswapV3.getPricesVolume(
              tokenA,
              tokenB,
              regularSellAmounts,
              SwapSide.SELL,
              blockNumber,
              pools,
            );
            console.log(
              `${tokenASymbol} <> ${tokenBSymbol} Pool Prices: `,
              poolPrices,
            );

            expect(poolPrices).not.toBeNull();
            checkPoolPrices(
              poolPrices!,
              regularSellAmounts,
              SwapSide.SELL,
              dexKey,
            );

            let falseChecksCounter = 0;
            await Promise.all(
              poolPrices!.map(async price => {
                const fee =
                  pancakeswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
                const res = await checkOnChainPricing(
                  pancakeswapV3,
                  dexHelper,
                  'quoteExactInputSingle',
                  blockNumber,
                  price.prices,
                  tokenA.address,
                  tokenB.address,
                  fee,
                  regularSellAmounts,
                );
                if (res === false) falseChecksCounter++;
              }),
            );

            expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
          });

          it('getPoolIdentifiers and getPricesVolume BUY', async function () {
            const pools = await pancakeswapV3.getPoolIdentifiers(
              tokenA,
              tokenB,
              SwapSide.BUY,
              blockNumber,
            );
            console.log(
              `${stableASymbol} <> ${stableBSymbol} Pool Identifiers: `,
              pools,
            );

            expect(pools.length).toBeGreaterThan(0);

            const poolPrices = await pancakeswapV3.getPricesVolume(
              tokenA,
              tokenB,
              regularBuyAmounts,
              SwapSide.BUY,
              blockNumber,
              pools,
            );
            console.log(
              `${tokenASymbol} <> ${tokenBSymbol} Pool Prices: `,
              poolPrices,
            );

            expect(poolPrices).not.toBeNull();
            checkPoolPrices(
              poolPrices!,
              regularBuyAmounts,
              SwapSide.BUY,
              dexKey,
            );

            // Check if onchain pricing equals to calculated ones
            let falseChecksCounter = 0;
            await Promise.all(
              poolPrices!.map(async price => {
                const fee =
                  pancakeswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
                const res = await checkOnChainPricing(
                  pancakeswapV3,
                  dexHelper,
                  'quoteExactOutputSingle',
                  blockNumber,
                  price.prices,
                  tokenA.address,
                  tokenB.address,
                  fee,
                  regularBuyAmounts,
                );
                if (res === false) falseChecksCounter++;
              }),
            );
            expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
          });

          it('getTopPoolsForToken', async function () {
            const poolLiquidity = await pancakeswapV3.getTopPoolsForToken(
              tokenA.address,
              10,
            );
            console.log(`${stableASymbol} Top Pools:`, poolLiquidity);

            if (!pancakeswapV3.hasConstantPriceLargeAmounts) {
              checkPoolsLiquidity(poolLiquidity, stableA.address, dexKey);
            }
          });
        });
      }
    }),
  );
});

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: Address,
  tokenOut: Address,
  fee: bigint,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      [tokenIn, tokenOut, amount, fee, 0n],
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
  pancakeswapV3: PancakeswapV3,
  dexHelper: DummyDexHelper,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  fee: bigint,
  _amounts: bigint[],
) {
  // Quoter address
  const exchangeAddress = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
  const readerIface = quoterIface;

  const sum = prices.reduce((acc, curr) => (acc += curr), 0n);

  if (sum === 0n) {
    console.log(
      `Prices were not calculated for tokenIn=${tokenIn}, tokenOut=${tokenOut}, fee=${fee.toString()}. Most likely price impact is too big for requested amount`,
    );
    return false;
  }

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    _amounts.slice(1),
    funcName,
    tokenIn,
    tokenOut,
    fee,
  );

  let readerResult;
  try {
    readerResult = (
      await dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
  } catch (e) {
    console.log(
      `Can not fetch on-chain pricing for fee ${fee}. It happens for low liquidity pools`,
    );
    return false;
  }

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  let firstZeroIndex = prices.slice(1).indexOf(0n);

  // we skipped first, so add +1 on result
  firstZeroIndex = firstZeroIndex === -1 ? prices.length : firstZeroIndex;

  console.log('PRICE: ', prices);
  console.log('ON-chain prices: ', prices);

  // Compare only the ones for which we were able to calculate prices
  expect(prices.slice(0, firstZeroIndex)).toEqual(
    expectedPrices.slice(0, firstZeroIndex),
  );
  return true;
}
