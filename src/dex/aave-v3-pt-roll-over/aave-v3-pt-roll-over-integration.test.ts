/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Token } from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AaveV3PtRollOverData } from './types';

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/dummy-dex-helper';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AaveV3PtRollOver } from './aave-v3-pt-roll-over';
import PENDLE_ORACLE_ABI from '../../abi/PendleOracle.json';

const checkOnChainPricing = async (
  aaveV3PtRollOver: AaveV3PtRollOver,
  functionName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  srcToken: Token,
  destToken: Token,
  dexHelper: IDexHelper,
  data: AaveV3PtRollOverData,
) => {
  // Import the oracle interface for direct on-chain calls
  const oracleInterface = new Interface(PENDLE_ORACLE_ABI);
  const oracleAddress = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2';

  try {
    // Prepare multicall for getting rates directly from Pendle Oracle
    const calls = [
      // Source market PT to asset rate
      {
        target: oracleAddress,
        callData: oracleInterface.encodeFunctionData(functionName, [
          data.srcMarketAddress,
          1800, // 30 minutes duration
        ]),
      },
      // Destination market PT to asset rate
      {
        target: oracleAddress,
        callData: oracleInterface.encodeFunctionData(functionName, [
          data.destMarketAddress,
          1800, // 30 minutes duration
        ]),
      },
    ];

    const result = await dexHelper.multiContract.methods
      .aggregate(calls)
      .call({}, blockNumber);

    // Decode the rates
    const [srcRate] = oracleInterface.decodeFunctionResult(
      functionName,
      result.returnData[0],
    );
    const [destRate] = oracleInterface.decodeFunctionResult(
      functionName,
      result.returnData[1],
    );

    const srcPtToAssetRate = BigInt(srcRate.toString());
    const destPtToAssetRate = BigInt(destRate.toString());

    // Calculate expected exchange rate: srcPT -> asset -> destPT
    const exchangeRate = (srcPtToAssetRate * BigInt(1e18)) / destPtToAssetRate;

    // Calculate expected prices for each amount
    const expectedPrices: bigint[] = [];
    for (const amount of amounts) {
      if (amount === 0n) {
        expectedPrices.push(0n);
      } else {
        // Calculate the actual output amount for this input amount
        const outputAmount = (amount * exchangeRate) / BigInt(1e18);
        expectedPrices.push(outputAmount);
      }
    }

    console.log('On-chain prices:', expectedPrices);
    console.log('Calculated prices:', prices);

    // Allow for small differences due to rounding
    for (let i = 0; i < prices.length; i++) {
      const price = prices[i];
      const expectedPrice = expectedPrices[i];

      if (price === 0n && expectedPrice === 0n) {
        continue; // Both zero, ok
      }

      // Allow up to 0.01% difference for rounding
      const diff =
        price > expectedPrice ? price - expectedPrice : expectedPrice - price;
      const tolerance = expectedPrice / 10000n; // 0.01%

      if (diff > tolerance) {
        throw new Error(
          `Price mismatch at index ${i}: got ${price}, expected ${expectedPrice}, diff ${diff} > tolerance ${tolerance}`,
        );
      }
    }

    console.log('✅ On-chain pricing check passed');
  } catch (error) {
    console.error('❌ On-chain pricing check failed:', error);
    throw error;
  }
};

async function testPricingOnNetwork(
  aaveV3PtRollOver: AaveV3PtRollOver,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcName: string,
) {
  const networkTokens = Tokens[network];

  const pools = await aaveV3PtRollOver.getPoolIdentifiers(
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

  const poolPrices = await aaveV3PtRollOver.getPricesVolume(
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
  checkPoolPrices(poolPrices!, amounts, side, dexKey);

  // Check if onchain pricing equals to the pricing returned by the implementation
  await checkOnChainPricing(
    aaveV3PtRollOver,
    funcName,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    aaveV3PtRollOver.dexHelper,
    poolPrices![0].data,
  );
}

describe('AaveV3Pendle', function () {
  const dexKey = 'AaveV3Pendle';
  let blockNumber: number;
  let aaveV3PtRollOver: AaveV3PtRollOver;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'PT-sUSDe-31JUL2025';
    const destTokenSymbol = 'PT-sUSDe-25SEP2025';

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
      aaveV3PtRollOver = new AaveV3PtRollOver(network, dexKey, dexHelper);
      if (aaveV3PtRollOver.initializePricing) {
        await aaveV3PtRollOver.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        aaveV3PtRollOver,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        'getPtToAssetRate',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        aaveV3PtRollOver,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
        'getPtToAssetRate',
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3PtRollOver = new AaveV3PtRollOver(
        network,
        dexKey,
        dexHelper,
      );
      if (newAaveV3PtRollOver.updatePoolState) {
        await newAaveV3PtRollOver.updatePoolState();
      }
      const poolLiquidity = await newAaveV3PtRollOver.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newAaveV3PtRollOver.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
