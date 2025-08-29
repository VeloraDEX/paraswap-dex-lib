/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper';
import { Network, SwapSide } from '../../constants';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { BI_POWS } from '../../bigint-constants';
import { Solidly } from './solidly';
import { Tokens } from '../../../tests/constants-e2e';
import { Interface, Result } from '@ethersproject/abi';
import solidlyPairABI from '../../abi/solidly/SolidlyPair.json';
import { SpiritSwapV2 } from './forks-override/spiritSwapV2';
import { Chronos } from './forks-override/chronos';
import { Ramses } from './forks-override/ramses';
import * as util from 'util';
import { VelodromeV2 } from './forks-override/velodromeV2';
import { Equalizer } from './forks-override/equalizer';
import { Velocimeter } from './forks-override/velocimeter';
import { Usdfi } from './forks-override/usdfi';
import { PharaohV1 } from './forks-override/pharaohV1';

const amounts18 = [0n, BI_POWS[18], 2000000000000000000n];
const amounts6 = [0n, BI_POWS[6], 2000000n];

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [amount, tokenIn]),
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

const constructCheckOnChainPricing =
  (dexHelper: DummyDexHelper) =>
  async (
    solidly: Solidly,
    funcName: string,
    blockNumber: number,
    prices: bigint[],
    exchangeAddress: string,
    tokenIn: string,
    amounts: bigint[],
  ) => {
    const readerIface = new Interface(solidlyPairABI as any);

    const readerCallData = getReaderCalldata(
      exchangeAddress,
      readerIface,
      amounts.slice(1),
      funcName,
      tokenIn,
    );

    const readerResult = (
      await dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
    const expectedPrices = [0n].concat(
      decodeReaderResult(readerResult, readerIface, funcName),
    );

    console.log('ON-CHAIN PRICES: ', expectedPrices);

    expect(prices.map(p => p.toString())).toEqual(
      expectedPrices.map(p => p.toString()),
    );
  };

describe('Solidly integration tests', () => {
  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);
    const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

    describe('Dystopia', function () {
      const dexKey = 'Dystopia';
      const dystopia = new Solidly(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'WETH';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'WMATIC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await dystopia.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await dystopia.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              dystopia,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await dystopia.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'DAI'; // 'USDT';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18; // amounts6;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await dystopia.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await dystopia.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              dystopia,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await dystopia.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });
    });
  });

  describe('BSC', () => {
    const network = Network.BSC;
    const dexHelper = new DummyDexHelper(network);
    const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

    describe('Usdfi', function () {
      const dexKey = 'Usdfi';
      const usdfi = new Usdfi(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'USDFI';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDT';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await usdfi.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await usdfi.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              usdfi,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await usdfi.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'USDT';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'BUSD';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts6;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await usdfi.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await usdfi.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              usdfi,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await usdfi.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });

      describe('FRAX -> frxETH', () => {
        const TokenASymbol = 'FRAX';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'frxETH';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await usdfi.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await usdfi.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              usdfi,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });
      });
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);
    const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

    describe('Chronos', function () {
      const dexKey = 'Chronos';
      const chronos = new Chronos(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'USDC';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'WETH';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await chronos.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await chronos.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              chronos,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await chronos.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'USDT';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts6;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await chronos.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await chronos.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              chronos,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await chronos.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });
    });

    describe('Ramses', function () {
      const dexKey = 'Ramses';
      const ramses = new Ramses(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'USDCe';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'WETH';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await ramses.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          console.log('AMOUNTS: ', amounts);

          const poolPrices = await ramses.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            util.inspect(poolPrices, false, null, true),
          );

          expect(poolPrices).not.toBeNull();
          // checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              ramses,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await ramses.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'USDT';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDCe';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts6;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await ramses.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await ramses.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              ramses,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await ramses.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });
    });
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);
    const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

    describe('PharaohV1', function () {
      const dexKey = 'PharaohV1';
      const pharaohV1 = new PharaohV1(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'USDC';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'WAVAX';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await pharaohV1.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          console.log('AMOUNTS: ', amounts);

          const poolPrices = await pharaohV1.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            util.inspect(poolPrices, false, null, true),
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              pharaohV1,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await pharaohV1.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'USDT';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts6;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await pharaohV1.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await pharaohV1.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              pharaohV1,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });

        it('getTopPoolsForToken', async function () {
          const poolLiquidity = await pharaohV1.getTopPoolsForToken(
            tokenA.address,
            10,
          );
          console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

          checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
        });
      });
    });
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;
    const dexHelper = new DummyDexHelper(network);
    const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

    describe('VelodromeV2', () => {
      const dexKey = 'VelodromeV2';
      const velodromeV2 = new VelodromeV2(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'USDC';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'WETH';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume SELL', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await velodromeV2.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await velodromeV2.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              velodromeV2,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'USDT';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts6;

        it('getPoolIdentifiers and getPricesVolume SELL', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await velodromeV2.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await velodromeV2.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              velodromeV2,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });
      });
    });
  });

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

    describe('Equalizer', () => {
      const dexKey = 'Equalizer';
      const equalizer = new Equalizer(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'USDbC';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'ETH';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await equalizer.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await equalizer.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              equalizer,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });
      });
    });

    describe('Velocimeter', () => {
      const dexKey = 'Velocimeter';
      const velocimeter = new Velocimeter(network, dexKey, dexHelper);

      describe('UniswapV2 like pool', function () {
        const TokenASymbol = 'WETH';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDbC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts18;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await velocimeter.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await velocimeter.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones

          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              velocimeter,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });
      });

      describe('Curve like stable pool', function () {
        const TokenASymbol = 'USDbC';
        const tokenA = Tokens[network][TokenASymbol];
        const TokenBSymbol = 'USDC';
        const tokenB = Tokens[network][TokenBSymbol];

        const amounts = amounts6; // amounts6;

        it('getPoolIdentifiers and getPricesVolume', async function () {
          const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
          const pools = await velocimeter.getPoolIdentifiers(
            tokenA,
            tokenB,
            SwapSide.SELL,
            blocknumber,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
            pools,
          );

          expect(pools.length).toBeGreaterThan(0);

          const poolPrices = await velocimeter.getPricesVolume(
            tokenA,
            tokenB,
            amounts,
            SwapSide.SELL,
            blocknumber,
            pools,
          );
          console.log(
            `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
            poolPrices,
          );

          expect(poolPrices).not.toBeNull();
          checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

          // Check if onchain pricing equals to calculated ones
          for (const poolPrice of poolPrices || []) {
            await checkOnChainPricing(
              velocimeter,
              'getAmountOut',
              blocknumber,
              poolPrice.prices,
              poolPrice.poolAddresses![0],
              tokenA.address,
              amounts,
            );
          }
        });
      });
    });
  });
});
