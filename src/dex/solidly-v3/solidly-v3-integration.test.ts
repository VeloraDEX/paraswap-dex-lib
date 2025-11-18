/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper, IDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { SolidlyV3 } from './solidly-v3';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from './constants';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '@paraswap/core';
import SolidlyV3PoolABI from '../../abi/solidly-v3/SolidlyV3Pool.abi.json';

/*
  README
  ======

  This test script adds tests for SolidlyV3 general integration
  with the DEX interface. The test cases below are example tests.
  It is recommended to add tests which cover SolidlyV3 specific
  logic.

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-integration.test.ts`

  (This comment should be removed from the final implementation)
*/

const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);

const WETH = Tokens[network]['WETH'];
const USDC = Tokens[network]['USDC'];

const amounts = [0n, 1n * BI_POWS[18], 2n * BI_POWS[18]];
// Sell WETH to receive 1000 USDC, 2000 UDST, and 3000 USDC
const amountsBuy = [
  0n,
  1000n * BI_POWS[6],
  2000n * BI_POWS[6],
  3000n * BI_POWS[6],
];

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  zeroForOne: boolean,
  sqrtPriceLimitX96: bigint,
  exactInput: boolean,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      zeroForOne,
      exactInput ? amount.toString() : `-${amount.toString()}`,
      sqrtPriceLimitX96.toString(),
    ]),
  }));
}

// We are only using this function to decode `quoteSwap` on SolidlyV3Pool. The output param we consider relevant
// depends on `zeroForOne` and `exactInput`.
function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
  zeroForOne: boolean,
  exactInput: boolean,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    // zeroForOne determines whether we want to get amount0 or amount1
    let index;
    if (zeroForOne == exactInput) {
      index = 1;
    } else {
      index = 0;
    }
    return parsed[index]._hex[0] == '-'
      ? BigInt(parsed[index]._hex.slice(1))
      : BigInt(parsed[index]._hex);
  });
}

async function checkOnChainPricing(
  dexHelper: IDexHelper,
  blockNumber: number,
  poolAddress: string,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  tickSpacing: bigint,
  _amounts: bigint[],
  exactInput: boolean,
) {
  const readerIface = new Interface(SolidlyV3PoolABI);

  const sum = prices.reduce((acc, curr) => (acc += curr), 0n);

  if (sum === 0n) {
    console.log(
      `Prices were not calculated for tokenIn=${tokenIn}, tokenOut=${tokenOut}, tickSpacing=${tickSpacing.toString()}. Most likely price impact is too big for requested amount`,
    );
    return false;
  }

  const readerCallData = getReaderCalldata(
    poolAddress,
    readerIface,
    _amounts.slice(1),
    'quoteSwap',
    tokenIn < tokenOut,
    tokenIn < tokenOut
      ? MIN_SQRT_RATIO + BigInt(1)
      : MAX_SQRT_RATIO - BigInt(1),
    exactInput,
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
      `Can not fetch on-chain pricing for tickSpacing ${tickSpacing}. It happens for low liquidity pools`,
      e,
    );
    return false;
  }

  const expectedPrices = [0n].concat(
    decodeReaderResult(
      readerResult,
      readerIface,
      'quoteSwap',
      tokenIn < tokenOut,
      exactInput,
    ),
  );

  console.log('EXPECTED PRICES: ', expectedPrices);

  let firstZeroIndex = prices.slice(1).indexOf(0n);

  // we skipped first, so add +1 on result
  firstZeroIndex = firstZeroIndex === -1 ? prices.length : firstZeroIndex;

  // Compare only the ones for which we were able to calculate prices
  expect(prices.slice(0, firstZeroIndex)).toEqual(
    expectedPrices.slice(0, firstZeroIndex),
  );
  return true;
}

async function testPricingOnNetwork(
  solidlyV3: SolidlyV3,
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

  const pools = await solidlyV3.getPoolIdentifiers(
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

  const poolPrices = await solidlyV3.getPricesVolume(
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
  if (solidlyV3.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }
}

describe('SolidlyV3', function () {
  const dexKey = 'SolidlyV3';
  let blockNumber: number;
  let solidlyV3: SolidlyV3;

  beforeEach(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const solidlyV3 = new SolidlyV3(network, dexKey, dexHelper);
  });

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    // TODO: Put here token Symbol to check against
    // Don't forget to update relevant tokens in constant-e2e.ts
    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'USDC';

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      solidlyV3 = new SolidlyV3(network, dexKey, dexHelper);
      if (solidlyV3.initializePricing) {
        await solidlyV3.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const pools = await solidlyV3.getPoolIdentifiers(
        WETH,
        USDC,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(`WETH <> USDC Pool Identifiers: `, pools);

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await solidlyV3.getPricesVolume(
        WETH,
        USDC,
        amounts,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(`WETH <> USDC Pool Prices: `, poolPrices);

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const tickSpacing =
            solidlyV3.eventPools[price.poolIdentifiers![0]]!.tickSpacing;
          const res = await checkOnChainPricing(
            dexHelper,
            blockNumber,
            solidlyV3.eventPools[price.poolIdentifiers![0]]!.poolAddress,
            price.prices,
            WETH.address,
            USDC.address,
            tickSpacing,
            amounts,
            true,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const pools = await solidlyV3.getPoolIdentifiers(
        WETH,
        USDC,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(`WETH <> USDC Pool Identifiers: `, pools);

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await solidlyV3.getPricesVolume(
        WETH,
        USDC,
        amountsBuy,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(`WETH <> USDC Pool Prices: `, poolPrices);

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amountsBuy, SwapSide.BUY, dexKey);

      let falseChecksCounter = 0;
      await Promise.all(
        poolPrices!.map(async price => {
          const tickSpacing =
            solidlyV3.eventPools[price.poolIdentifiers![0]]!.tickSpacing;
          const res = await checkOnChainPricing(
            dexHelper,
            blockNumber,
            solidlyV3.eventPools[price.poolIdentifiers![0]]!.poolAddress,
            price.prices,
            WETH.address,
            USDC.address,
            tickSpacing,
            amountsBuy,
            false,
          );
          if (res === false) falseChecksCounter++;
        }),
      );

      expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newSolidlyV3 = new SolidlyV3(network, dexKey, dexHelper);
      // if (newSolidlyV3.updatePoolState) {
      //   await newSolidlyV3.updatePoolState();
      // }
      const poolLiquidity = await newSolidlyV3.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newSolidlyV3.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
