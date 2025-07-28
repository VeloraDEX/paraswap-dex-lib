/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper, IDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Algebra } from './algebra';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '@paraswap/core';
import { AlgebraEventPoolV1_1 } from './algebra-pool-v1_1';
import { DecodedStateMultiCallResultWithRelativeBitmapsV1_1 } from './types';

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
      tokenIn,
      tokenOut,
      amount,
      0n,
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
  algebra: Algebra,
  dexHelper: IDexHelper,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  amounts: bigint[],
) {
  const exchangeAddress = algebra.config.quoter;

  const readerIface = algebra.quoterIface;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    tokenIn,
    tokenOut,
  );
  const readerResult = (
    await dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  algebra: Algebra,
  network: Network,
  dexKey: string,
  dexHelper: IDexHelper,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
) {
  const networkTokens = Tokens[network];

  const pools = await algebra.getPoolIdentifiers(
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

  const poolPrices = await algebra.getPricesVolume(
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
  if (algebra.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    algebra,
    dexHelper,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
    amounts,
  );
}

describe('CamelotV3', function () {
  const dexKey = 'CamelotV3';
  let blockNumber: number;
  let algebra: Algebra;

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    describe('GRAIL => USDCe', () => {
      const srcTokenSymbol = 'GRAIL';
      const destTokenSymbol = 'USDCe';

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
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        algebra = new Algebra(network, dexKey, dexHelper);
        if (algebra.initializePricing) {
          await algebra.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          algebra,
          network,
          dexKey,
          dexHelper,
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
          algebra,
          network,
          dexKey,
          dexHelper,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'quoteExactOutputSingle',
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newAlgebra = new Algebra(network, dexKey, dexHelper);
        const poolLiquidity = await newAlgebra.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newAlgebra.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe('USDCe => GRAIL', () => {
      const srcTokenSymbol = 'USDCe';
      const destTokenSymbol = 'GRAIL';

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
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
        4n * BI_POWS[tokens[destTokenSymbol].decimals],
        5n * BI_POWS[tokens[destTokenSymbol].decimals],
        6n * BI_POWS[tokens[destTokenSymbol].decimals],
        7n * BI_POWS[tokens[destTokenSymbol].decimals],
        8n * BI_POWS[tokens[destTokenSymbol].decimals],
        9n * BI_POWS[tokens[destTokenSymbol].decimals],
        10n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        algebra = new Algebra(network, dexKey, dexHelper);
        if (algebra.initializePricing) {
          await algebra.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          algebra,
          network,
          dexKey,
          dexHelper,
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
          algebra,
          network,
          dexKey,
          dexHelper,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'quoteExactOutputSingle',
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newAlgebra = new Algebra(network, dexKey, dexHelper);
        const poolLiquidity = await newAlgebra.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newAlgebra.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });
});

describe('Algebra', function () {
  const dexKey = 'QuickSwapV3';
  let blockNumber: number;
  let algebra: Algebra;

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WMATIC';
    const destTokenSymbol = 'DAI';
    // const destTokenSymbol = 'USDC';

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

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals],
      2n * BI_POWS[tokens[destTokenSymbol].decimals],
      3n * BI_POWS[tokens[destTokenSymbol].decimals],
      4n * BI_POWS[tokens[destTokenSymbol].decimals],
      5n * BI_POWS[tokens[destTokenSymbol].decimals],
      6n * BI_POWS[tokens[destTokenSymbol].decimals],
      7n * BI_POWS[tokens[destTokenSymbol].decimals],
      8n * BI_POWS[tokens[destTokenSymbol].decimals],
      9n * BI_POWS[tokens[destTokenSymbol].decimals],
      10n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      algebra = new Algebra(network, dexKey, dexHelper);
      if (algebra.initializePricing) {
        await algebra.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        algebra,
        network,
        dexKey,
        dexHelper,
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
        algebra,
        network,
        dexKey,
        dexHelper,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        'quoteExactOutputSingle',
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAlgebra = new Algebra(network, dexKey, dexHelper);
      const poolLiquidity = await newAlgebra.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newAlgebra.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it('both generate state result match', async function () {
      const pool = (await algebra.getPool(
        tokens[srcTokenSymbol].address,
        tokens[destTokenSymbol].address,
        blockNumber,
      )) as AlgebraEventPoolV1_1;

      const [balance0, balance1, stateMulticallFull] =
        await pool.fetchPoolStateSingleStep(blockNumber);

      const stateMulticall = {
        pool: stateMulticallFull.pool.toLowerCase(),
        globalState: {
          price: stateMulticallFull.globalState.price,
          tick: stateMulticallFull.globalState.tick,
          fee: stateMulticallFull.globalState.fee,
          communityFeeToken0: stateMulticallFull.globalState.communityFeeToken0,
          communityFeeToken1: stateMulticallFull.globalState.communityFeeToken1,
        },
        liquidity: stateMulticallFull.liquidity,
        tickSpacing: stateMulticallFull.tickSpacing,
        maxLiquidityPerTick: stateMulticallFull.maxLiquidityPerTick,
        tickBitmap: stateMulticallFull.tickBitmap.map(t => ({
          index: t.index,
          value: t.value,
        })),
        ticks: stateMulticallFull.ticks.map(t => ({
          index: t.index,
          value: {
            liquidityNet: t.value.liquidityNet,
            liquidityGross: t.value.liquidityGross,
            secondsOutside: t.value.secondsOutside,
            secondsPerLiquidityOutsideX128:
              t.value.secondsPerLiquidityOutsideX128,
            tickCumulativeOutside: t.value.tickCumulativeOutside,
            initialized: t.value.initialized,
          },
        })),
      };

      const stateMulticallWithBalance = [balance0, balance1, stateMulticall];
      const stateManually = await pool.fetchStateManually(blockNumber);
      // @ts-ignore
      delete stateManually[2]['blockTimestamp'];
      stateManually[2].pool = stateManually[2].pool.toLowerCase();

      expect(stateMulticallWithBalance).toStrictEqual(stateManually);
    });
  });
});
