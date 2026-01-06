/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import util from 'node:util';

import { Interface, Result } from '@ethersproject/abi';
import { Tokens } from '../../../tests/constants-e2e';
import {
  checkConstantPoolPrices,
  checkPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { BI_POWS } from '../../bigint-constants';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { EkuboV3 } from './ekubo-v3';
import { EkuboData } from './types';
import { DEX_KEY, ROUTER_ADDRESS } from './config';
import { hexDataSlice } from 'ethers/lib/utils';
import { BigNumber } from 'ethers';

const NO_SQRT_RATIO_LIMIT = 0n;

function getReaderCalldata(
  quoterAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  { poolKeyAbi, isToken1, skipAhead }: EkuboData,
) {
  return amounts.map(amount => ({
    target: quoterAddress,
    callData: readerIface.encodeFunctionData('quote', [
      poolKeyAbi,
      isToken1,
      amount,
      NO_SQRT_RATIO_LIMIT,
      skipAhead[amount.toString()] ?? 0,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  isToken1: boolean,
  swapSide: SwapSide,
): bigint[] {
  return results.map(result => {
    const balanceUpdate: string = readerIface.decodeFunctionResult(
      'quote',
      result,
    ).balanceUpdate;
    const delta = BigNumber.from(
      isToken1
        ? hexDataSlice(balanceUpdate, 0, 16)
        : hexDataSlice(balanceUpdate, 16, 32),
    )
      .fromTwos(128)
      .toBigInt();

    return swapSide === SwapSide.BUY ? delta : -delta;
  });
}

async function checkOnChainPricing(
  ekubo: EkuboV3,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  side: SwapSide,
  data: EkuboData,
) {
  if (side === SwapSide.BUY) {
    amounts = amounts.map(amount => -amount);
  }

  const readerCallData = getReaderCalldata(
    ROUTER_ADDRESS,
    ekubo.routerIface,
    amounts.slice(1),
    data,
  );

  const readerResult = (
    await ekubo.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, ekubo.routerIface, data.isToken1, side),
  );

  expect(prices.length).toEqual(expectedPrices.length);

  for (let i = 0; i < expectedPrices.length; i++) {
    const price = prices[i];
    expect([price - 1n, price, price + 1n]).toContain(expectedPrices[i]);
  }
}

async function testPricingOnNetwork(
  ekubo: EkuboV3,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await ekubo.getPoolIdentifiers(
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

  const poolPrices = await ekubo.getPricesVolume(
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
  if (ekubo.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    ekubo,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    side,
    poolPrices![0].data,
  );
}

let blockNumber: number;
let ekubo: EkuboV3;

describe('Mainnet', () => {
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const tokens = Tokens[network];

  const srcTokenSymbol = 'USDC';
  const destTokenSymbol = 'USDT';

  const amountsForSell = [
    0n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 1n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 2n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 3n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 4n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 5n,
  ];

  const amountsForBuy = [
    0n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 1n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 2n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 3n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 4n,
    (BI_POWS[tokens[srcTokenSymbol].decimals] / 10n) * 5n,
  ];

  beforeAll(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    ekubo = new EkuboV3(network, DEX_KEY, dexHelper);
    if (ekubo.initializePricing) {
      await ekubo.initializePricing(blockNumber);
    }
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    await testPricingOnNetwork(
      ekubo,
      network,
      DEX_KEY,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.SELL,
      amountsForSell,
    );
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    await testPricingOnNetwork(
      ekubo,
      network,
      DEX_KEY,
      blockNumber,
      srcTokenSymbol,
      destTokenSymbol,
      SwapSide.BUY,
      amountsForBuy,
    );
  });

  it('getTopPoolsForToken', async function () {
    const ekubo = new EkuboV3(network, DEX_KEY, dexHelper);
    await ekubo.updatePoolState();

    const poolLiquidity = await ekubo.getTopPoolsForToken(
      tokens[srcTokenSymbol].address,
      10,
    );
    console.log(
      `${srcTokenSymbol} Top Pools:`,
      util.inspect(poolLiquidity, { depth: null }),
    );

    checkPoolsLiquidity(
      poolLiquidity,
      Tokens[network][srcTokenSymbol].address,
      DEX_KEY,
    );
  });
});
