/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, JsonFragment, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { CurveV1Factory } from './curve-v1-factory';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '@paraswap/core';
import StableSwap3PoolABI from '../../abi/curve-v1/StableSwap3Pool.json';
import CurveV1StableNgPoolAbi from '../../abi/curve-v1/CurveV1StableNg.json';
import * as util from 'util';

export function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  i: number,
  j: number,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [i, j, amount]),
  }));
}

export function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

export async function checkOnChainPricing(
  curveV1Factory: CurveV1Factory,
  exchangeAddress: Address,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  i: number,
  j: number,
  readerIface: Interface,
) {
  // const readerIface = new Interface(StableSwap3PoolABI as JsonFragment[]);

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    i,
    j,
  );

  const readerResult = (
    await curveV1Factory.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

export async function testPricingOnNetwork(
  curveV1Factory: CurveV1Factory,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  poolContractMethod = 'get_dy',
  readerIface = new Interface(StableSwap3PoolABI as JsonFragment[]),
) {
  const networkTokens = Tokens[network];

  const pools = await curveV1Factory.getPoolIdentifiers(
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

  const poolPrices = await curveV1Factory.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    util.inspect(poolPrices, false, null, true),
  );

  expect(poolPrices).not.toBeNull();
  if (curveV1Factory.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    curveV1Factory,
    poolPrices![0].data.path[0].exchange,
    poolPrices![0].data.path[0].underlyingSwap
      ? 'get_dy_underlying'
      : poolContractMethod,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    poolPrices![0].data.path[0].i,
    poolPrices![0].data.path[0].j,
    readerIface,
  );
}

describe('CurveV1Factory', function () {
  const dexKey = 'CurveV1Factory';
  let blockNumber: number;
  let curveV1Factory: CurveV1Factory;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      console.log(
        `Received blockNumber ${blockNumber} on network ${dexHelper.config.data.network}`,
      );
      curveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (curveV1Factory.initializePricing) {
        await curveV1Factory.initializePricing(blockNumber);
      }
    });

    afterAll(() => {
      if (curveV1Factory) curveV1Factory.releaseResources();
    });

    describe(`USDD-USDT`, () => {
      const srcTokenSymbol = 'USDD';
      const destTokenSymbol = 'USDT';
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

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1Factory,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1Factory = new CurveV1Factory(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1Factory.updatePoolState) {
          await newCurveV1Factory.updatePoolState();
        }
        const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe(`crvUSD-GHO`, () => {
      const readerIface = new Interface(
        CurveV1StableNgPoolAbi as JsonFragment[],
      );

      const srcTokenSymbol = 'crvUSD';
      const destTokenSymbol = 'GHO';
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
      ];

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1Factory,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          curveV1Factory,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1Factory = new CurveV1Factory(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1Factory.updatePoolState) {
          await newCurveV1Factory.updatePoolState();
        }
        const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe(`crvUSD-USDT`, () => {
      const readerIface = new Interface(
        CurveV1StableNgPoolAbi as JsonFragment[],
      );

      const srcTokenSymbol = 'crvUSD';
      const destTokenSymbol = 'USDT';
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
      ];

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1Factory,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        console.log('amountsForBuy: ', amountsForBuy);
        await testPricingOnNetwork(
          curveV1Factory,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1Factory = new CurveV1Factory(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1Factory.updatePoolState) {
          await newCurveV1Factory.updatePoolState();
        }
        const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });

    describe(`renBTC-wibBTC`, () => {
      const srcTokenSymbol = 'renBTC';
      const destTokenSymbol = 'wibBTC';
      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        4n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        5n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        6n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        7n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        8n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        9n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
        10n * BI_POWS[tokens[srcTokenSymbol].decimals - 1],
      ];

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1Factory,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1Factory = new CurveV1Factory(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1Factory.updatePoolState) {
          await newCurveV1Factory.updatePoolState();
        }
        const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });
  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDC';
    const destTokenSymbol = 'axlUSDC';

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
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      curveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (curveV1Factory.initializePricing) {
        await curveV1Factory.initializePricing(blockNumber);
      }
    });

    afterAll(() => {
      if (curveV1Factory) curveV1Factory.releaseResources();
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        curveV1Factory,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newCurveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (newCurveV1Factory.updatePoolState) {
        await newCurveV1Factory.updatePoolState();
      }
      const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'YUSD';
    const destTokenSymbol = 'USDC';

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
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      curveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (curveV1Factory.initializePricing) {
        await curveV1Factory.initializePricing(blockNumber);
      }
    });

    afterAll(() => {
      if (curveV1Factory) curveV1Factory.releaseResources();
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        curveV1Factory,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newCurveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (newCurveV1Factory.updatePoolState) {
        await newCurveV1Factory.updatePoolState();
      }
      const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'VST';
    const destTokenSymbol = 'FRAX';

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
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      curveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (curveV1Factory.initializePricing) {
        await curveV1Factory.initializePricing(blockNumber);
      }
    });

    afterAll(() => {
      if (curveV1Factory) curveV1Factory.releaseResources();
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        curveV1Factory,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newCurveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (newCurveV1Factory.updatePoolState) {
        await newCurveV1Factory.updatePoolState();
      }
      const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
  describe('Optimism', () => {
    const network = Network.OPTIMISM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'sETH';
    const destTokenSymbol = 'ETH';

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
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      curveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (curveV1Factory.initializePricing) {
        await curveV1Factory.initializePricing(blockNumber);
      }
    });

    afterAll(() => {
      if (curveV1Factory) curveV1Factory.releaseResources();
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        curveV1Factory,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newCurveV1Factory = new CurveV1Factory(network, dexKey, dexHelper);
      if (newCurveV1Factory.updatePoolState) {
        await newCurveV1Factory.updatePoolState();
      }
      const poolLiquidity = await newCurveV1Factory.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newCurveV1Factory.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
