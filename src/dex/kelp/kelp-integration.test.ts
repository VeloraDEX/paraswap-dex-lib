/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result, JsonFragment } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Kelp } from './kelp';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import lrtDepositPoolAbi from '../../abi/kelp/LRTDepositPool.json';
import { KelpConfig } from './config';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  srcToken: string,
  amounts: bigint[],
  funcName: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [srcToken, amount]),
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
  kelp: Kelp,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  srcToken: string,
) {
  const exchangeAddress =
    KelpConfig.Kelp[kelp.network].lrtDepositPool.toLowerCase();

  const readerIface = new Interface(lrtDepositPoolAbi as JsonFragment[]);

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    srcToken,
    amounts.slice(1),
    funcName,
  );
  const readerResult = (
    await kelp.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  kelp: Kelp,
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

  const pools = await kelp.getPoolIdentifiers(
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

  const poolPrices = await kelp.getPricesVolume(
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
  if (kelp.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  const actualSrcTokenSymbol =
    srcTokenSymbol === 'WETH'
      ? 'ETH'
      : srcTokenSymbol === 'wstETH'
      ? 'STETH'
      : srcTokenSymbol;

  let actualSrcAmounts: bigint[] = [];

  if (srcTokenSymbol === 'wstETH') {
    const actualSrcAmountsPromises = amounts.map(amount =>
      kelp.getActualSrcAmount(networkTokens[srcTokenSymbol].address, amount),
    );
    actualSrcAmounts = await Promise.all(actualSrcAmountsPromises);
  } else {
    actualSrcAmounts = amounts;
  }

  await checkOnChainPricing(
    kelp,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    actualSrcAmounts,
    networkTokens[actualSrcTokenSymbol].address,
  );
}

describe('Kelp', function () {
  const dexKey = 'Kelp';
  let blockNumber: number;
  let kelp: Kelp;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbols = ['ETH', 'WETH', 'STETH', 'wstETH', 'ETHx'];
    const destTokenSymbol = 'rsETH';
    const decimals = 18;

    const amountsForSell = [
      0n,
      1n * BI_POWS[decimals],
      2n * BI_POWS[decimals],
      3n * BI_POWS[decimals],
      4n * BI_POWS[decimals],
      5n * BI_POWS[decimals],
      6n * BI_POWS[decimals],
      7n * BI_POWS[decimals],
      8n * BI_POWS[decimals],
      9n * BI_POWS[decimals],
      10n * BI_POWS[decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      kelp = new Kelp(network, dexKey, dexHelper);
      if (kelp.initializePricing) {
        await kelp.initializePricing(blockNumber);
      }
    });

    srcTokenSymbols.forEach(srcTokenSymbol => {
      it(`getPoolIdentifiers and getPricesVolume SELL (${srcTokenSymbol} -> ${destTokenSymbol})`, async function () {
        await testPricingOnNetwork(
          kelp,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'getRsETHAmountToMint',
        );
      });

      it(`getTopPoolsForToken for ${srcTokenSymbol}`, async function () {
        const newKelp = new Kelp(network, dexKey, dexHelper);
        if (newKelp.updatePoolState) {
          await newKelp.updatePoolState();
        }
        const poolLiquidity = await newKelp.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newKelp.hasConstantPriceLargeAmounts) {
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
