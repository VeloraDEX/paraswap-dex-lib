/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

// Nami pools sit below Velora's production TVL floor while liquidity is being
// seeded, so lower it here only, to exercise pricing against real pools.
jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  MIN_USD_TVL_FOR_PRICING: 0,
}));

import { DummyDexHelper } from '../../../dex-helper/index';
import { Network, SwapSide } from '../../../constants';
import { BI_POWS } from '../../../bigint-constants';
import { NamiV4 } from './nami-v4';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../../tests/utils';
import { Tokens } from '../../../../tests/constants-e2e';
import { Address } from '@paraswap/core';

async function checkOnChainPricing(
  namiV4: NamiV4,
  blockNumber: number,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  deployer: Address,
  amounts: bigint[],
  side: SwapSide,
) {
  const isSELL = side === SwapSide.SELL;
  const amountsToCheck = amounts.slice(1);

  const quotes = amountsToCheck.map(amount =>
    namiV4.buildQuoteCallData(tokenIn, tokenOut, deployer, amount, isSELL),
  );

  const readerResult = (
    await namiV4.dexHelper.multiContract.methods
      .aggregate(quotes.map(({ target, callData }) => ({ target, callData })))
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    quotes.map((quote, i) => quote.decodeFunction(readerResult[i])),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  namiV4: NamiV4,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await namiV4.getPoolIdentifiers(
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

  const poolPrices = await namiV4.getPricesVolume(
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
  if (namiV4.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // The quoter runs the real beforeSwap hook, so this also checks that the
  // directional fee taken from plugin.swapFee() matches what a swap pays.
  await checkOnChainPricing(
    namiV4,
    blockNumber,
    poolPrices![0].prices,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
    poolPrices![0].data.path[0].deployer,
    amounts,
    side,
  );
}

function testNetwork(
  network: Network,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  sellUnits: bigint,
  buyUnits: bigint,
) {
  const dexKey = 'NamiV4';
  const dexHelper = new DummyDexHelper(network);
  const tokens = Tokens[network];

  let blockNumber: number;
  let namiV4: NamiV4;

  const amountsForSell = [0n].concat(
    Array.from(
      { length: 10 },
      (_, i) =>
        (BigInt(i + 1) * sellUnits * BI_POWS[tokens[srcTokenSymbol].decimals]) /
        10000n,
    ),
  );

  const amountsForBuy = [0n].concat(
    Array.from(
      { length: 10 },
      (_, i) =>
        (BigInt(i + 1) * buyUnits * BI_POWS[tokens[destTokenSymbol].decimals]) /
        10000n,
    ),
  );

  beforeAll(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    namiV4 = new NamiV4(network, dexKey, dexHelper);
    await namiV4.initializePricing(blockNumber);
  });

  afterAll(() => {
    namiV4.releaseResources();
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    await testPricingOnNetwork(
      namiV4,
      network,
      dexKey,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.SELL,
      amountsForSell,
    );
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    await testPricingOnNetwork(
      namiV4,
      network,
      dexKey,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.BUY,
      amountsForBuy,
    );
  });

  it('getTopPoolsForToken', async function () {
    const newNamiV4 = new NamiV4(network, dexKey, dexHelper);
    await newNamiV4.updatePoolState();
    const poolLiquidity = await newNamiV4.getTopPoolsForToken(
      tokens[srcTokenSymbol].address,
      10,
    );
    console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

    if (!newNamiV4.hasConstantPriceLargeAmounts) {
      checkPoolsLiquidity(
        poolLiquidity,
        tokens[srcTokenSymbol].address,
        dexKey,
      );
    }
  });
}

// Amounts are in ten-thousandths of a token unit so thinly seeded pools still
// price every step without running out of range.
describe('NamiV4', function () {
  describe('Base', () => {
    testNetwork(Network.BASE, 'WETH', 'USDC', 1n, 5000n);
  });

  describe('Mainnet', () => {
    testNetwork(Network.MAINNET, 'WETH', 'USDC', 1n, 5000n);
  });

  describe('Robinhood', () => {
    testNetwork(Network.ROBINHOOD, 'WETH', 'USDG', 1n, 5000n);
  });
});
