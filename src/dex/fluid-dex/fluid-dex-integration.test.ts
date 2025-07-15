/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { FluidDex } from './fluid-dex';
import { Tokens } from '../../../tests/constants-e2e';
import ResolverABI from '../../abi/fluid-dex/resolver.abi.json';
import { Contract } from 'ethers';
import { Pool } from './types';

/*
  README
  ======

  This test script adds tests for FluidDex general integration
  with the DEX interface. The test cases below are example tests.
  It is recommended to add tests which cover FluidDex specific
  logic.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-integration.test.ts`

  (This comment should be removed from the final implementation)
*/

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  poolAddress: string,
  amounts: bigint[],
  funcName: string,
  pools: { address: string; token0: string; token1: string }[],
  srcToken: string,
) {
  const pool = pools.find(
    item => item.address.toLowerCase() === poolAddress.toLowerCase(),
  );

  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      poolAddress,
      pool!.token0.toLowerCase() === srcToken.toLowerCase() ? true : false,
      amount,
      0,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    return BigInt(result);
  });
}

async function checkOnChainPricing(
  fluidDex: FluidDex,
  funcName: string,
  poolAddress: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  dexHelper: DummyDexHelper,
  srcToken: string,
) {
  const resolverAddress = '0x45f4ad57e300da55c33dea579a40fcee000d7b94';

  const readerIface = new Interface(ResolverABI);

  const resolverContract = new Contract(
    resolverAddress,
    ResolverABI,
    dexHelper.provider,
  );
  const rawResult = await resolverContract.callStatic.getAllPools({
    blockTag: blockNumber,
  });

  const pools: Pool[] = rawResult.map((result: any) => ({
    address: result[0],
    token0: result[1],
    token1: result[2],
  }));

  const readerCallData = getReaderCalldata(
    resolverAddress,
    readerIface,
    poolAddress,
    amounts.slice(1),
    funcName,
    pools,
    srcToken,
  );

  const readerResult = (
    await fluidDex.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  fluidDex: FluidDex,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
  dexHelper: DummyDexHelper,
) {
  const networkTokens = Tokens[network];

  const pools = await fluidDex.getPoolIdentifiers(
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

  const poolPrices = await fluidDex.getPricesVolume(
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
  console.log(
    'logged params : ',
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  expect(poolPrices).not.toBeNull();

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    fluidDex,
    funcNameToCheck,
    poolPrices![0].poolAddresses![0],
    blockNumber,
    poolPrices![0].prices,
    amounts,
    dexHelper,
    networkTokens[srcTokenSymbol].address,
  );
}

describe('FluidDex', function () {
  const dexKey = 'FluidDex';
  let blockNumber: number;
  let fluidDex: FluidDex;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    beforeAll(async () => {
      blockNumber = await dexHelper.provider.getBlockNumber();
      fluidDex = new FluidDex(network, dexKey, dexHelper);
      if (fluidDex.initializePricing) {
        await fluidDex.initializePricing(blockNumber);
      }
    });

    describe('wstETH -> ETH', () => {
      const tokenASymbol = 'wstETH';
      const tokenBSymbol = 'ETH';

      const amountsForSwap = [
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

      it('wstETH -> ETH, getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenASymbol,
          tokenBSymbol,
          SwapSide.SELL,
          amountsForSwap,
          'estimateSwapIn',
          dexHelper,
        );
      });

      it('wstETH -> ETH, getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenASymbol,
          tokenBSymbol,
          SwapSide.BUY,
          amountsForSwap,
          'estimateSwapOut',
          dexHelper,
        );
      });

      it('ETH -> wstETH, getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenBSymbol,
          tokenASymbol,
          SwapSide.SELL,
          amountsForSwap,
          'estimateSwapIn',
          dexHelper,
        );
      });

      it('ETH -> wstETH, getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenBSymbol,
          tokenASymbol,
          SwapSide.BUY,
          amountsForSwap,
          'estimateSwapOut',
          dexHelper,
        );
      });
    });

    describe('USDC -> USDT', () => {
      const tokenASymbol = 'USDC';
      const tokenBSymbol = 'USDT';

      const amountsForSwap = [
        0n,
        10n * BI_POWS[6],
        20n * BI_POWS[6],
        30n * BI_POWS[6],
        40n * BI_POWS[6],
        50n * BI_POWS[6],
        60n * BI_POWS[6],
        70n * BI_POWS[6],
        80n * BI_POWS[6],
        90n * BI_POWS[6],
        100n * BI_POWS[6],
        1000n * BI_POWS[6],
      ];

      it('USDC -> USDT getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenASymbol,
          tokenBSymbol,
          SwapSide.SELL,
          amountsForSwap,
          'estimateSwapIn',
          dexHelper,
        );
      });

      it('USDC -> USDT getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenASymbol,
          tokenBSymbol,
          SwapSide.BUY,
          amountsForSwap,
          'estimateSwapOut',
          dexHelper,
        );
      });

      it('USDT -> USDC getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenBSymbol,
          tokenASymbol,
          SwapSide.SELL,
          amountsForSwap,
          'estimateSwapIn',
          dexHelper,
        );
      });

      it('USDT -> USDC getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          fluidDex,
          network,
          dexKey,
          blockNumber,
          tokenBSymbol,
          tokenASymbol,
          SwapSide.BUY,
          amountsForSwap,
          'estimateSwapOut',
          dexHelper,
        );
      });
    });
  });
});
