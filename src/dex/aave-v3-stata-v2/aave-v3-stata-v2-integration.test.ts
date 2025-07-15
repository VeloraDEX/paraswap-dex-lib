/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AaveV3StataV2 } from './aave-v3-stata-v2';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [amount]),
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
  aaveV3Statav2: AaveV3StataV2,
  exchangeAddress: string,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const readerIface = AaveV3StataV2.stata;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
  );
  const readerResult = (
    await aaveV3Statav2.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  aaveV3Statav2: AaveV3StataV2,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  exchangeAddress: string,
  funcNameToCheck: string,
) {
  const networkTokens = Tokens[network];

  const pools = await aaveV3Statav2.getPoolIdentifiers(
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

  const poolPrices = await aaveV3Statav2.getPricesVolume(
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
  if (aaveV3Statav2.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    aaveV3Statav2,
    exchangeAddress,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

describe('AaveV3StataV2', function () {
  const dexKey = 'AaveV3StataV2';
  let blockNumber: number;
  let aaveV3Statav2: AaveV3StataV2;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDT';
    const destTokenSymbol = 'waEthUSDT';

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
      aaveV3Statav2 = new AaveV3StataV2(network, dexKey, dexHelper);
      if (aaveV3Statav2.initializePricing) {
        await aaveV3Statav2.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL USDT -> waEthUSDT', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8',
        'previewDeposit',
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL waEthUSDT -> USDT ', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8',
        'previewRedeem',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY USDT -> waEthUSDT', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        '0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8',
        'previewMint',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY waEthUSDT -> USDT', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        '0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8',
        'previewWithdraw',
      );
    });

    it(`getTopPoolsForToken - ${srcTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3Stata = new AaveV3StataV2(network, dexKey, dexHelper);
      if (newAaveV3Stata.updatePoolState) {
        await newAaveV3Stata.updatePoolState();
      }
      const poolLiquidity = await newAaveV3Stata.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newAaveV3Stata.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken - ${destTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3Stata = new AaveV3StataV2(network, dexKey, dexHelper);
      if (newAaveV3Stata.updatePoolState) {
        await newAaveV3Stata.updatePoolState();
      }
      const poolLiquidity = await newAaveV3Stata.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );
      console.log(
        `${destTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newAaveV3Stata.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'wstETH';
    const destTokenSymbol = 'waGnowstETH';

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
      aaveV3Statav2 = new AaveV3StataV2(network, dexKey, dexHelper);
      if (aaveV3Statav2.initializePricing) {
        await aaveV3Statav2.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL wstETH -> waGnowstETH', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2',
        'previewDeposit',
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL waGnowstETH -> wstETH', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2',
        'previewRedeem',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY wstETH -> waGnowstETH', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        '0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2',
        'previewMint',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY waGnowstETH -> wstETH', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        '0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2',
        'previewWithdraw',
      );
    });

    it(`getTopPoolsForToken - ${srcTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3Stata = new AaveV3StataV2(network, dexKey, dexHelper);
      if (newAaveV3Stata.updatePoolState) {
        await newAaveV3Stata.updatePoolState();
      }
      const poolLiquidity = await newAaveV3Stata.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newAaveV3Stata.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken - ${destTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3Stata = new AaveV3StataV2(network, dexKey, dexHelper);
      if (newAaveV3Stata.updatePoolState) {
        await newAaveV3Stata.updatePoolState();
      }
      const poolLiquidity = await newAaveV3Stata.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );
      console.log(
        `${destTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newAaveV3Stata.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  // polygon is not yet live
  describe.skip('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDCn';
    const destTokenSymbol = 'stataUSDCn';

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
      aaveV3Statav2 = new AaveV3StataV2(network, dexKey, dexHelper);
      if (aaveV3Statav2.initializePricing) {
        await aaveV3Statav2.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL USDCn -> stataUSDCn', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '0x2dca80061632f3f87c9ca28364d1d0c30cd79a19',
        'previewDeposit',
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL stataUSDCn -> USDCn ', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        '0x2dca80061632f3f87c9ca28364d1d0c30cd79a19',
        'previewRedeem',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY USDC -> stataUSDCn', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        '0x2dca80061632f3f87c9ca28364d1d0c30cd79a19',
        'previewMint',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY stataUSDCn -> USDC', async function () {
      await testPricingOnNetwork(
        aaveV3Statav2,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        '0x2dca80061632f3f87c9ca28364d1d0c30cd79a19',
        'previewWithdraw',
      );
    });

    it(`getTopPoolsForToken - ${srcTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3Stata = new AaveV3StataV2(network, dexKey, dexHelper);
      if (newAaveV3Stata.updatePoolState) {
        await newAaveV3Stata.updatePoolState();
      }
      const poolLiquidity = await newAaveV3Stata.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newAaveV3Stata.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken - ${destTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3Stata = new AaveV3StataV2(network, dexKey, dexHelper);
      if (newAaveV3Stata.updatePoolState) {
        await newAaveV3Stata.updatePoolState();
      }
      const poolLiquidity = await newAaveV3Stata.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );
      console.log(
        `${destTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newAaveV3Stata.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
