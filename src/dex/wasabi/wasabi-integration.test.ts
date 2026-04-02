/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Wasabi } from './wasabi';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import WasabiPoolABI from '../../abi/wasabi/WasabiPool.json';

const poolIface = new Interface(WasabiPoolABI);

function getReaderCalldata(
  poolAddress: string,
  tokenIn: string,
  amounts: bigint[],
) {
  return amounts.map(amount => ({
    target: poolAddress,
    callData: poolIface.encodeFunctionData('quoteExactInput', [
      tokenIn,
      amount,
    ]),
  }));
}

function decodeReaderResult(results: string[]) {
  return results.map(result => {
    const parsed = poolIface.decodeFunctionResult('quoteExactInput', result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  wasabi: Wasabi,
  poolAddress: string,
  tokenIn: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const readerCallData = getReaderCalldata(
    poolAddress,
    tokenIn,
    amounts.slice(1),
  );

  const readerResult = (
    await wasabi.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(decodeReaderResult(readerResult));

  // Since we apply a buffer, on-chain prices will be >= our prices
  for (let i = 1; i < prices.length; i++) {
    if (expectedPrices[i] === 0n) continue;
    // Our buffered price should be <= on-chain price
    expect(prices[i]).toBeLessThanOrEqual(expectedPrices[i]);
    // But within 2% (buffer is typically 1%)
    const lowerBound = (expectedPrices[i] * 98n) / 100n;
    expect(prices[i]).toBeGreaterThanOrEqual(lowerBound);
  }
}

async function testPricingOnNetwork(
  wasabi: Wasabi,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await wasabi.getPoolIdentifiers(
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

  const poolPrices = await wasabi.getPricesVolume(
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

  // Check on-chain pricing for the first pool result
  const data = poolPrices![0].data;
  await checkOnChainPricing(
    wasabi,
    data.pool,
    data.tokenIn,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

describe('Wasabi', function () {
  const dexKey = 'Wasabi';
  let blockNumber: number;
  let wasabi: Wasabi;

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'USDC';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      wasabi = new Wasabi(network, dexKey, dexHelper);
      if (wasabi.initializePricing) {
        await wasabi.initializePricing(blockNumber);
      }
    });

    afterAll(() => {
      wasabi.releaseResources();
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        wasabi,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL reverse', async function () {
      await testPricingOnNetwork(
        wasabi,
        network,
        dexKey,
        blockNumber,
        destTokenSymbol,
        srcTokenSymbol,
        SwapSide.SELL,
        [
          0n,
          1000n * BI_POWS[tokens[destTokenSymbol].decimals],
          2000n * BI_POWS[tokens[destTokenSymbol].decimals],
        ],
      );
    });

    it('getTopPoolsForToken', async function () {
      const newWasabi = new Wasabi(network, dexKey, dexHelper);
      if (newWasabi.updatePoolState) {
        await newWasabi.updatePoolState();
      }
      const poolLiquidity = await newWasabi.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(
        poolLiquidity,
        Tokens[network][srcTokenSymbol].address,
        dexKey,
      );
    });
  });
});
