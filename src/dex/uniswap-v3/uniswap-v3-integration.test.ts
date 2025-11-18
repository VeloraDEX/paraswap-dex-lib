/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper, IDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { UniswapV3 } from './uniswap-v3';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import UniswapV3QuoterV2ABI from '../../abi/uniswap-v3/UniswapV3QuoterV2.abi.json';
import VelodromeSlipstreamQuoterV2ABI from '../../abi/velodrome-slipstream/VelodromeSlipstreamQuoterV2.abi.json';
import { Address } from '@paraswap/core';
import { UniswapV3Config } from './config';
import { VelodromeSlipstream } from './forks/velodrome-slipstream/velodrome-slipstream';

const network = Network.POLYGON;
const TokenASymbol = 'USDC';
const TokenA = Tokens[network][TokenASymbol];

const TokenBSymbol = 'WMATIC';
const TokenB = Tokens[network][TokenBSymbol];

const amounts = [
  0n,
  10_000n * BI_POWS[6],
  20_000n * BI_POWS[6],
  30_000n * BI_POWS[6],
];

const amountsBuy = [0n, 1n * BI_POWS[18], 2n * BI_POWS[18], 3n * BI_POWS[18]];

const quoterIface = new Interface(UniswapV3QuoterV2ABI);
const velodromeQuoterIface = new Interface(VelodromeSlipstreamQuoterV2ABI);

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
      [tokenIn, tokenOut, amount.toString(), fee.toString(), 0],
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
  dexHelper: IDexHelper,
  uniswapV3: UniswapV3,
  funcName: string,
  blockNumber: number,
  exchangeAddress: string,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  fee: bigint,
  _amounts: bigint[],
  readerIface = quoterIface,
) {
  // Quoter address
  // const exchangeAddress = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';

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

  console.log('blockNumber: ', blockNumber);
  console.log('readerCallData: ', readerCallData);

  let readerResult;
  try {
    readerResult = (
      await dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
  } catch (e) {
    console.log('E: ', e);
    console.log(
      `Can not fetch on-chain pricing for fee ${fee}. It happens for low liquidity pools`,
      e,
    );
    return false;
  }

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  let firstZeroIndex = prices.slice(1).indexOf(0n);

  // we skipped first, so add +1 on result
  firstZeroIndex = firstZeroIndex === -1 ? prices.length : firstZeroIndex;

  console.log('prices: ', prices);
  console.log('expectedPrices: ', expectedPrices);

  // Compare only the ones for which we were able to calculate prices
  expect(prices.slice(0, firstZeroIndex)).toEqual(
    expectedPrices.slice(0, firstZeroIndex),
  );

  expect(prices).toStrictEqual(expectedPrices);

  return true;
}

describe('UniswapV3', () => {
  const dexHelper = new DummyDexHelper(network);
  const dexKey = 'UniswapV3';

  let blockNumber: number;
  let uniswapV3: UniswapV3;
  let uniswapV3Mainnet: UniswapV3;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    describe('DAI -> USDC', () => {
      const TokenASymbol = 'DAI';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDC';
      const TokenB = Tokens[network][TokenBSymbol];

      beforeEach(async () => {
        // blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        blockNumber = 21766507;
        uniswapV3 = new UniswapV3(network, dexKey, dexHelper);

        console.log('blocknumber: ', blockNumber);
      });

      it('DAI -> USDC getPoolIdentifiers and getPricesVolume SELL', async () => {
        const amounts = [
          0n,
          2n * BI_POWS[18],
          3n * BI_POWS[18],
          4n * BI_POWS[18],
          5n * BI_POWS[18],
          6n * BI_POWS[18],
          7n * BI_POWS[18],
          8n * BI_POWS[18],
          9n * BI_POWS[18],
          10n * BI_POWS[18],
        ];

        const pools = await uniswapV3.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const prices = await uniswapV3.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        const poolPrices = prices?.filter(
          price =>
            price.poolIdentifiers![0] &&
            price.poolIdentifiers![0].toLowerCase() ===
              'UniswapV3_0x6b175474e89094c44da98b954eedeac495271d0f_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_10000'.toLowerCase(),
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        // checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const fee =
              uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
            const res = await checkOnChainPricing(
              dexHelper,
              uniswapV3,
              'quoteExactInputSingle',
              blockNumber,
              '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
              price.prices,
              TokenA.address,
              TokenB.address,
              fee,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('DAI -> USDC getPricesVolume through PRC fallback SELL', async () => {
        const amounts = [
          0n,
          1n * BI_POWS[18],
          2n * BI_POWS[18],
          3n * BI_POWS[18],
          4n * BI_POWS[18],
          5n * BI_POWS[18],
          6n * BI_POWS[18],
          7n * BI_POWS[18],
          8n * BI_POWS[18],
          9n * BI_POWS[18],
          10n * BI_POWS[18],
        ];

        // PRC pricing breaks if this condition is not met
        expect(amounts.length).toBeGreaterThan(uniswapV3['config'].chunksCount);

        // Get pool IDs
        const pools = await uniswapV3.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );

        expect(pools.length).toBeGreaterThan(0);

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        // Nullify pool states to trigger the fallback
        pools.forEach(poolId => {
          const poolInstance = uniswapV3.eventPools[poolId];

          if (!poolInstance) {
            return;
          }

          poolInstance._setState(null, blockNumber);
        });

        const prices = await uniswapV3.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        const poolPrices = prices;

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();

        const asserts = await Promise.all(
          poolPrices!.map(async price =>
            checkOnChainPricing(
              dexHelper,
              uniswapV3,
              'quoteExactInputSingle',
              blockNumber,
              '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
              price.prices,
              TokenA.address,
              TokenB.address,
              uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode,
              amounts,
            ),
          ),
        );

        expect(asserts.every(Boolean)).toEqual(true);
      });

      it('DAI -> USDC getPoolIdentifiers and getPricesVolume BUY', async () => {
        const amounts = [
          0n,
          2n * BI_POWS[18],
          3n * BI_POWS[18],
          4n * BI_POWS[18],
          5n * BI_POWS[18],
        ];

        const pools = await uniswapV3.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const prices = await uniswapV3.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );

        console.log('poolPrices: ');

        const poolPrices = prices?.filter(
          price =>
            price.poolIdentifiers![0] &&
            price.poolIdentifiers![0].toLowerCase() ===
              'UniswapV3_0x6b175474e89094c44da98b954eedeac495271d0f_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_10000'.toLowerCase(),
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        // checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const fee =
              uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
            const res = await checkOnChainPricing(
              dexHelper,
              uniswapV3,
              'quoteExactOutputSingle',
              blockNumber,
              '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
              price.prices,
              TokenA.address,
              TokenB.address,
              fee,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('USDC -> DAI getPoolIdentifiers and getPricesVolume SELL', async () => {
        const amounts = [
          0n,
          2n * BI_POWS[6],
          3n * BI_POWS[6],
          4n * BI_POWS[6],
          5n * BI_POWS[6],
        ];

        const pools = await uniswapV3.getPoolIdentifiers(
          TokenB,
          TokenA,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const prices = await uniswapV3.getPricesVolume(
          TokenB,
          TokenA,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        const poolPrices = prices?.filter(
          price =>
            price.poolIdentifiers![0] &&
            price.poolIdentifiers![0].toLowerCase() ===
              'UniswapV3_0x6b175474e89094c44da98b954eedeac495271d0f_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_10000'.toLowerCase(),
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        // checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const fee =
              uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
            const res = await checkOnChainPricing(
              dexHelper,
              uniswapV3,
              'quoteExactInputSingle',
              blockNumber,
              '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
              price.prices,
              TokenB.address,
              TokenA.address,
              fee,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('USDC -> DAI getPoolIdentifiers and getPricesVolume BUY', async () => {
        const amounts = [
          0n,
          1n * BI_POWS[17],
          5n * BI_POWS[17],
          5n * BI_POWS[17],
          6n * BI_POWS[17],
          7n * BI_POWS[17],
          8n * BI_POWS[17],
          9n * BI_POWS[17],
          1n * BI_POWS[18],
          2n * BI_POWS[18],
          3n * BI_POWS[18],
        ];

        const pools = await uniswapV3.getPoolIdentifiers(
          TokenB,
          TokenA,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const prices = await uniswapV3.getPricesVolume(
          TokenB,
          TokenA,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );

        const poolPrices = prices?.filter(
          price =>
            price.poolIdentifiers![0] &&
            price.poolIdentifiers![0].toLowerCase() ===
              'UniswapV3_0x6b175474e89094c44da98b954eedeac495271d0f_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_10000'.toLowerCase(),
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        // checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const fee =
              uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
            const res = await checkOnChainPricing(
              dexHelper,
              uniswapV3,
              'quoteExactOutputSingle',
              blockNumber,
              '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
              price.prices,
              TokenB.address,
              TokenA.address,
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

  describe('Arbitrum', () => {
    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      uniswapV3 = new UniswapV3(network, dexKey, dexHelper);
      uniswapV3Mainnet = new UniswapV3(
        Network.ARBITRUM,
        dexKey,
        new DummyDexHelper(Network.ARBITRUM),
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const pools = await uniswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await uniswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            uniswapV3,
            'quoteExactInputSingle',
            blockNumber,
            '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const pools = await uniswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await uniswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amountsBuy, SwapSide.BUY, dexKey);

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            uniswapV3,
            'quoteExactOutputSingle',
            blockNumber,
            '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume SELL stable pairs', async function () {
      const TokenASymbol = 'USDT';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDC';
      const TokenB = Tokens[network][TokenBSymbol];

      const amounts = [
        0n,
        6000000n,
        12000000n,
        18000000n,
        24000000n,
        30000000n,
        36000000n,
        42000000n,
        48000000n,
        54000000n,
        60000000n,
        66000000n,
        72000000n,
        78000000n,
        84000000n,
        90000000n,
        96000000n,
        102000000n,
        108000000n,
        114000000n,
        120000000n,
        126000000n,
        132000000n,
        138000000n,
        144000000n,
        150000000n,
        156000000n,
        162000000n,
        168000000n,
        174000000n,
        180000000n,
        186000000n,
        192000000n,
        198000000n,
        204000000n,
        210000000n,
        216000000n,
        222000000n,
        228000000n,
        234000000n,
        240000000n,
        246000000n,
        252000000n,
        258000000n,
        264000000n,
        270000000n,
        276000000n,
        282000000n,
        288000000n,
        294000000n,
        300000000n,
      ];

      const pools = await uniswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await uniswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

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
          const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            uniswapV3,
            'quoteExactInputSingle',
            blockNumber,
            '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY stable pairs', async function () {
      const TokenASymbol = 'DAI';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDC';
      const TokenB = Tokens[network][TokenBSymbol];

      const amountsBuy = [
        0n,
        6000000n,
        12000000n,
        18000000n,
        24000000n,
        30000000n,
        36000000n,
        42000000n,
        48000000n,
        54000000n,
        60000000n,
        66000000n,
        72000000n,
        78000000n,
        84000000n,
        90000000n,
        96000000n,
        102000000n,
        108000000n,
        114000000n,
        120000000n,
        126000000n,
        132000000n,
        138000000n,
        144000000n,
        150000000n,
        156000000n,
        162000000n,
        168000000n,
        174000000n,
        180000000n,
        186000000n,
        192000000n,
        198000000n,
        204000000n,
        210000000n,
        216000000n,
        222000000n,
        228000000n,
        234000000n,
        240000000n,
        246000000n,
        252000000n,
        258000000n,
        264000000n,
        270000000n,
        276000000n,
        282000000n,
        288000000n,
        294000000n,
        300000000n,
      ];

      const pools = await uniswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await uniswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(
        poolPrices!.filter(pp => pp.unit !== 0n),
        amountsBuy,
        SwapSide.BUY,
        dexKey,
      );

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            uniswapV3,
            'quoteExactOutputSingle',
            blockNumber,
            '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async function () {
      const poolLiquidity = await uniswapV3Mainnet.getTopPoolsForToken(
        Tokens[Network.MAINNET]['USDC'].address,
        10,
      );
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      if (!uniswapV3.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
      }
    });
  });
});

describe('RamsesV2', () => {
  const dexKey = 'RamsesV2';
  let blockNumber: number;
  let uniswapV3: UniswapV3;
  let uniswapV3Mainnet: UniswapV3;

  const network = Network.ARBITRUM;
  const dexHelper = new DummyDexHelper(network);
  const TokenASymbol = 'USDCe';
  const TokenA = Tokens[network][TokenASymbol];

  const TokenBSymbol = 'USDC';
  const TokenB = Tokens[network][TokenBSymbol];

  beforeEach(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    uniswapV3 = new UniswapV3(network, dexKey, dexHelper);
    uniswapV3Mainnet = new UniswapV3(Network.ARBITRUM, dexKey, dexHelper);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const amounts = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
    ];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactInputSingle',
          blockNumber,
          '0xAA20EFF7ad2F523590dE6c04918DaAE0904E3b20',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    const amounts = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
    ];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.BUY,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.BUY,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactOutputSingle',
          blockNumber,
          '0xAA20EFF7ad2F523590dE6c04918DaAE0904E3b20',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });
});

describe('PharaohV2', () => {
  const dexKey = 'PharaohV2';
  let blockNumber: number;
  let uniswapV3: UniswapV3;
  let uniswapV3Mainnet: UniswapV3;

  const network = Network.AVALANCHE;
  const dexHelper = new DummyDexHelper(network);
  const TokenASymbol = 'USDC';
  const TokenA = Tokens[network][TokenASymbol];

  const TokenBSymbol = 'USDCe';
  const TokenB = Tokens[network][TokenBSymbol];

  beforeEach(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    uniswapV3 = new UniswapV3(network, dexKey, dexHelper);
    uniswapV3Mainnet = new UniswapV3(Network.AVALANCHE, dexKey, dexHelper);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const amounts = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
    ];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactInputSingle',
          blockNumber,
          '0xAAAEA10b0e6FBe566FE27c3A023DC5D8cA6Bca3d',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    const amounts = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
    ];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.BUY,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.BUY,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactOutputSingle',
          blockNumber,
          '0xAAAEA10b0e6FBe566FE27c3A023DC5D8cA6Bca3d',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getTopPoolsForToken', async function () {
    const poolLiquidity = await uniswapV3.getTopPoolsForToken(
      TokenB.address,
      10,
    );
    console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
  });
});

describe('ChronosV3', () => {
  const dexKey = 'ChronosV3';
  let blockNumber: number;
  let uniswapV3: UniswapV3;
  let uniswapV3Mainnet: UniswapV3;

  const network = Network.ARBITRUM;
  const dexHelper = new DummyDexHelper(network);
  const TokenASymbol = 'USDCe';
  const TokenA = Tokens[network][TokenASymbol];

  const TokenBSymbol = 'USDT';
  const TokenB = Tokens[network][TokenBSymbol];

  beforeEach(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    uniswapV3 = new UniswapV3(network, dexKey, dexHelper);
    uniswapV3Mainnet = new UniswapV3(Network.ARBITRUM, dexKey, dexHelper);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const amounts = [0n, BI_POWS[6], 2000000n];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactInputSingle',
          blockNumber,
          '0x6E7f0Ca45171a4440c0CDdF3A46A8dC5D4c2d4A0',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    const amounts = [0n, BI_POWS[6], 2000000n];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.BUY,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.BUY,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactOutputSingle',
          blockNumber,
          '0x6E7f0Ca45171a4440c0CDdF3A46A8dC5D4c2d4A0',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it.skip('getTopPoolsForToken', async function () {
    const poolLiquidity = await uniswapV3.getTopPoolsForToken(
      TokenB.address,
      10,
    );
    console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
  });
});

describe('SushiSwapV3', () => {
  const dexKey = 'SushiSwapV3';

  describe('Mainnet', () => {
    let blockNumber: number;
    let sushiSwapV3: UniswapV3;
    let sushiSwapV3Mainnet: UniswapV3;

    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const TokenASymbol = 'USDC';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'USDT';
    const TokenB = Tokens[network][TokenBSymbol];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      sushiSwapV3 = new UniswapV3(network, dexKey, dexHelper);
      sushiSwapV3Mainnet = new UniswapV3(Network.MAINNET, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const amounts = [0n, BI_POWS[6], 2000000n];

      const pools = await sushiSwapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await sushiSwapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee =
            sushiSwapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            sushiSwapV3,
            'quoteExactInputSingle',
            blockNumber,
            '0x64e8802FE490fa7cc61d3463958199161Bb608A7',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const amounts = [0n, BI_POWS[6], 2000000n];

      const pools = await sushiSwapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await sushiSwapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee =
            sushiSwapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            sushiSwapV3,
            'quoteExactOutputSingle',
            blockNumber,
            '0x64e8802FE490fa7cc61d3463958199161Bb608A7',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async function () {
      const poolLiquidity = await sushiSwapV3.getTopPoolsForToken(
        TokenB.address,
        10,
      );
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
    });
  });

  describe('Arbitrum', () => {
    let blockNumber: number;
    let sushiSwapV3: UniswapV3;
    let sushiSwapV3Mainnet: UniswapV3;

    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);
    const TokenASymbol = 'USDCe';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'USDT';
    const TokenB = Tokens[network][TokenBSymbol];

    beforeEach(async () => {
      // blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      blockNumber = 125789437;
      sushiSwapV3 = new UniswapV3(network, dexKey, dexHelper);
      sushiSwapV3Mainnet = new UniswapV3(Network.ARBITRUM, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const amounts = [0n, 100000000n, 200000000n];

      const pools = await sushiSwapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await sushiSwapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee =
            sushiSwapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            sushiSwapV3,
            'quoteExactOutputSingle',
            blockNumber,
            '0x0524E833cCD057e4d7A296e3aaAb9f7675964Ce1',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });
  });

  describe('Base', () => {
    let blockNumber: number;
    let sushiSwapV3: UniswapV3;
    let sushiSwapV3Mainnet: UniswapV3;

    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const TokenASymbol = 'USDbC';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'DAI';
    const TokenB = Tokens[network][TokenBSymbol];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      sushiSwapV3 = new UniswapV3(network, dexKey, dexHelper);
      sushiSwapV3Mainnet = new UniswapV3(Network.MAINNET, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const amounts = [0n, BI_POWS[6], 2000000n];

      const pools = await sushiSwapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await sushiSwapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee =
            sushiSwapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            sushiSwapV3,
            'quoteExactInputSingle',
            blockNumber,
            '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const amounts = [0n, BI_POWS[6], 2000000n];

      const pools = await sushiSwapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await sushiSwapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee =
            sushiSwapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            sushiSwapV3,
            'quoteExactOutputSingle',
            blockNumber,
            '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async function () {
      const poolLiquidity = await sushiSwapV3.getTopPoolsForToken(
        TokenB.address,
        10,
      );
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
    });
  });
});

describe('Retro', () => {
  const dexKey = 'Retro';

  describe('Polygon', () => {
    let blockNumber: number;
    let retro: UniswapV3;

    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);
    const TokenASymbol = 'USDC';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'USDT';
    const TokenB = Tokens[network][TokenBSymbol];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      retro = new UniswapV3(network, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const amounts = [0n, BI_POWS[6], 2000000n];

      const pools = await retro.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await retro.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = retro.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            retro,
            'quoteExactInputSingle',
            blockNumber,
            '0xfe08be075758935cb6cb9318d1fbb60920416d4e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const amounts = [0n, BI_POWS[6], 2000000n];

      const pools = await retro.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await retro.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = retro.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            retro,
            'quoteExactOutputSingle',
            blockNumber,
            '0xfe08be075758935cb6cb9318d1fbb60920416d4e',
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async function () {
      const poolLiquidity = await retro.getTopPoolsForToken(TokenB.address, 10);
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
    });
  });
});

describe('BaseswapV3', () => {
  const dexKey = 'BaseswapV3';

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    let blockNumber: number;
    let baseswapV3: UniswapV3;

    const TokenASymbol = 'USDC';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'WETH';
    const TokenB = Tokens[network][TokenBSymbol];

    const QuoterV2 = UniswapV3Config[dexKey][network].quoter;

    const amountsBuy = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
      48000000n,
      54000000n,
      60000000n,
      66000000n,
      72000000n,
      78000000n,
      84000000n,
      90000000n,
      96000000n,
      102000000n,
      108000000n,
      114000000n,
      120000000n,
      126000000n,
      132000000n,
      138000000n,
      144000000n,
      150000000n,
      156000000n,
      162000000n,
      168000000n,
      174000000n,
      180000000n,
      186000000n,
      192000000n,
      198000000n,
      204000000n,
      210000000n,
      216000000n,
      222000000n,
      228000000n,
      234000000n,
      240000000n,
      246000000n,
      252000000n,
      258000000n,
      264000000n,
      270000000n,
      276000000n,
      282000000n,
      288000000n,
      294000000n,
      300000000n,
    ];

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      baseswapV3 = new UniswapV3(network, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactInputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const amountsBuy = [
        0n,
        1n * BI_POWS[18],
        2n * BI_POWS[18],
        3n * BI_POWS[18],
      ];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amountsBuy, SwapSide.BUY, dexKey);

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactOutputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume SELL stable pairs', async function () {
      const TokenASymbol = 'USDbC';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDC';
      const TokenB = Tokens[network][TokenBSymbol];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(
        poolPrices!.filter(pp => pp.unit !== 0n),
        amountsBuy,
        SwapSide.SELL,
        dexKey,
      );

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactInputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY stable pairs', async function () {
      const TokenASymbol = 'DAI';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDC';
      const TokenB = Tokens[network][TokenBSymbol];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(
        poolPrices!.filter(pp => pp.unit !== 0n),
        amountsBuy,
        SwapSide.BUY,
        dexKey,
      );

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactOutputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async function () {
      const poolLiquidity = await baseswapV3.getTopPoolsForToken(
        TokenB.address,
        10,
      );
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
    });
  });
});

describe('SpookySwapV3', () => {
  const dexKey = 'SpookySwapV3';

  describe('Sonic', () => {
    const network = Network.SONIC;
    const dexHelper = new DummyDexHelper(network);

    let blockNumber: number;
    let baseswapV3: UniswapV3;

    const TokenASymbol = 'axlUSDC';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'MIM';
    const TokenB = Tokens[network][TokenBSymbol];

    const QuoterV2 = UniswapV3Config[dexKey][network].quoter;

    beforeEach(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      baseswapV3 = new UniswapV3(network, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async () => {
      const amounts = [
        0n,
        1n * BI_POWS[6],
        20n * BI_POWS[6],
        1000n * BI_POWS[6],
      ];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey, false);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactInputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async () => {
      const amountsBuy = [
        0n,
        1n * BI_POWS[18],
        2n * BI_POWS[18],
        3n * BI_POWS[18],
      ];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amountsBuy, SwapSide.BUY, dexKey);

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactOutputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume SELL stable pairs', async () => {
      const amounts = [0n, 1n * BI_POWS[6], 4n * BI_POWS[6]];

      const TokenASymbol = 'axlUSDC';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDCe';
      const TokenB = Tokens[network][TokenBSymbol];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(
        poolPrices!.filter(pp => pp.unit !== 0n),
        amounts,
        SwapSide.SELL,
        dexKey,
        false,
      );

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactInputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amounts,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY stable pairs', async () => {
      const amountsBuy = [
        0n,
        1n * BI_POWS[6],
        2n * BI_POWS[6],
        3n * BI_POWS[6],
      ];

      const TokenASymbol = 'axlUSDC';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDCe';
      const TokenB = Tokens[network][TokenBSymbol];

      const pools = await baseswapV3.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await baseswapV3.getPricesVolume(
        TokenA,
        TokenB,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(
        poolPrices!.filter(pp => pp.unit !== 0n),
        amountsBuy,
        SwapSide.BUY,
        dexKey,
      );

      // Check if onchain pricing equals to calculated ones
      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const fee = baseswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
          const res = await checkOnChainPricing(
            dexHelper,
            baseswapV3,
            'quoteExactOutputSingle',
            blockNumber,
            QuoterV2,
            price.prices,
            TokenA.address,
            TokenB.address,
            fee,
            amountsBuy,
          );
          if (res === false) falseChecksCounter++;
        }),
      );
      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async () => {
      const poolLiquidity = await baseswapV3.getTopPoolsForToken(
        TokenB.address,
        10,
      );
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
    });
  });
});

describe('Slipstream', () => {
  describe('VelodromeSlipstreamNewFactory', () => {
    const dexKey = 'VelodromeSlipstreamNewFactory';

    describe('Optimism', () => {
      let blockNumber: number;
      let slipstream: VelodromeSlipstream;

      const network = Network.OPTIMISM;
      const dexHelper = new DummyDexHelper(network);
      const TokenASymbol = 'USDC';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'WETH';
      const TokenB = Tokens[network][TokenBSymbol];

      beforeEach(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        slipstream = new VelodromeSlipstream(network, dexKey, dexHelper);
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async () => {
        const amounts = [0n, BI_POWS[6], BI_POWS[6] * 2n];

        const pools = await slipstream.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await slipstream.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const tickSpacing =
              slipstream.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
            const res = await checkOnChainPricing(
              dexHelper,
              slipstream,
              'quoteExactInputSingle',
              blockNumber,
              '0x89D8218ed5fF1e46d8dcd33fb0bbeE3be1621466',
              price.prices,
              TokenA.address,
              TokenB.address,
              tickSpacing,
              amounts,
              velodromeQuoterIface,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async () => {
        const amounts = [0n, BI_POWS[6], BI_POWS[6] * 2n];

        const pools = await slipstream.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await slipstream.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const tickSpacing =
              slipstream.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
            const res = await checkOnChainPricing(
              dexHelper,
              slipstream,
              'quoteExactOutputSingle',
              blockNumber,
              '0x89D8218ed5fF1e46d8dcd33fb0bbeE3be1621466',
              price.prices,
              TokenA.address,
              TokenB.address,
              tickSpacing,
              amounts,
              velodromeQuoterIface,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('getTopPoolsForToken', async () => {
        const poolLiquidity = await slipstream.getTopPoolsForToken(
          Tokens[network]['WETH'].address,
          10,
        );
        console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

        expect(poolLiquidity).toEqual([]); // no subgraph
      });
    });
  });

  describe('VelodromeSlipstream', () => {
    const dexKey = 'VelodromeSlipstream';

    describe('Unichain', () => {
      let blockNumber: number;
      let slipstream: VelodromeSlipstream;

      const network = Network.UNICHAIN;
      const dexHelper = new DummyDexHelper(network);
      const TokenASymbol = 'WETH';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'USDC';
      const TokenB = Tokens[network][TokenBSymbol];

      beforeEach(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        slipstream = new VelodromeSlipstream(network, dexKey, dexHelper);
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async () => {
        const amounts = [0n, BI_POWS[18], BI_POWS[18] * 2n];

        const pools = await slipstream.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await slipstream.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const tickSpacing =
              slipstream.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
            const res = await checkOnChainPricing(
              dexHelper,
              slipstream,
              'quoteExactInputSingle',
              blockNumber,
              '0x3FA596fAC2D6f7d16E01984897Ac04200Cb9cA05',
              price.prices,
              TokenA.address,
              TokenB.address,
              tickSpacing,
              amounts,
              velodromeQuoterIface,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async () => {
        const amounts = [0n, BI_POWS[6], BI_POWS[6] * 2n];

        const pools = await slipstream.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await slipstream.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const tickSpacing =
              slipstream.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
            const res = await checkOnChainPricing(
              dexHelper,
              slipstream,
              'quoteExactOutputSingle',
              blockNumber,
              '0x3FA596fAC2D6f7d16E01984897Ac04200Cb9cA05',
              price.prices,
              TokenA.address,
              TokenB.address,
              tickSpacing,
              amounts,
              velodromeQuoterIface,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('getTopPoolsForToken', async () => {
        const poolLiquidity = await slipstream.getTopPoolsForToken(
          TokenA.address,
          10,
        );
        console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

        checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
      });
    });
  });

  describe('AerodromeSlipstream', () => {
    const dexKey = 'AerodromeSlipstream';
    let blockNumber: number;
    let slipstream: VelodromeSlipstream;

    describe('Base', () => {
      const network = Network.BASE;
      const dexHelper = new DummyDexHelper(network);
      const TokenASymbol = 'DOG';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'WETH';
      const TokenB = Tokens[network][TokenBSymbol];

      beforeEach(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        slipstream = new VelodromeSlipstream(network, dexKey, dexHelper);
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async () => {
        const amounts = [0n, BI_POWS[18], BI_POWS[18] * 2n];

        const pools = await slipstream.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await slipstream.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const tickSpacing =
              slipstream.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
            const res = await checkOnChainPricing(
              dexHelper,
              slipstream,
              'quoteExactInputSingle',
              blockNumber,
              '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0',
              price.prices,
              TokenA.address,
              TokenB.address,
              tickSpacing,
              amounts,
              velodromeQuoterIface,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async () => {
        const amounts = [0n, BI_POWS[18], BI_POWS[18] * 2n];

        const pools = await slipstream.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await slipstream.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const tickSpacing =
              slipstream.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
            const res = await checkOnChainPricing(
              dexHelper,
              slipstream,
              'quoteExactOutputSingle',
              blockNumber,
              '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0',
              price.prices,
              TokenA.address,
              TokenB.address,
              tickSpacing,
              amounts,
              velodromeQuoterIface,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('getTopPoolsForToken', async () => {
        const poolLiquidity = await slipstream.getTopPoolsForToken(
          Tokens[network]['DOG'].address,
          10,
        );
        console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

        expect(poolLiquidity).toEqual([]); // no subgraph
      });
    });
  });
});

describe('PangolinV3', () => {
  const dexKey = 'PangolinV3';
  let blockNumber: number;
  let uniswapV3: UniswapV3;

  const network = Network.AVALANCHE;
  const dexHelper = new DummyDexHelper(network);

  const TokenASymbol = 'USDC';
  const TokenA = Tokens[network][TokenASymbol];

  const TokenBSymbol = 'USDT';
  const TokenB = Tokens[network][TokenBSymbol];

  beforeEach(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    uniswapV3 = new UniswapV3(network, dexKey, dexHelper);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const amounts = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
    ];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactInputSingle',
          blockNumber,
          '0xA86522CCc412dBC4FA10991900FE46De95983822',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    const amounts = [
      0n,
      6000000n,
      12000000n,
      18000000n,
      24000000n,
      30000000n,
      36000000n,
      42000000n,
    ];

    const pools = await uniswapV3.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.BUY,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV3.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.BUY,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const fee = uniswapV3.eventPools[price.poolIdentifiers![0]]!.feeCode;
        const res = await checkOnChainPricing(
          dexHelper,
          uniswapV3,
          'quoteExactOutputSingle',
          blockNumber,
          '0xA86522CCc412dBC4FA10991900FE46De95983822',
          price.prices,
          TokenA.address,
          TokenB.address,
          fee,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getTopPoolsForToken', async function () {
    const poolLiquidity = await uniswapV3.getTopPoolsForToken(
      TokenA.address,
      10,
    );
    console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
  });
});
