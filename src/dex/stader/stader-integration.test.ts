/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Stader } from './stader';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Interface, Result } from '@ethersproject/abi';
import SSPMABI from '../../abi/SSPM.json';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  poolAddress: string,
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
    return BigInt(result);
  });
}

async function checkOnChainPricing(
  stader: Stader,
  funcName: string,
  poolAddress: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  dexHelper: DummyDexHelper,
  srcToken: string,
) {
  const readerIface = new Interface(SSPMABI);
  const SSPMAddress = stader.SSPM_Address;

  const readerCallData = getReaderCalldata(
    SSPMAddress,
    readerIface,
    poolAddress,
    amounts.slice(1),
    funcName,
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

describe('Stader', function () {
  const dexKey = 'Stader';
  let blockNumber: number;
  let stader: Stader;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      stader = new Stader(network, dexKey, dexHelper);
      if (stader.initializePricing) {
        await stader.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume ETH -> ETHx SELL', async () => {
      const srcTokenSymbol = 'ETH';
      const destTokenSymbol = 'ETHx';

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

      const pools = await stader.getPoolIdentifiers(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await stader.getPricesVolume(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        amountsForSell,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amountsForSell, SwapSide.SELL, dexKey);

      // Check if onchain pricing equals to calculated ones
      await checkOnChainPricing(
        stader,
        'previewDeposit',
        poolPrices![0].poolAddresses![0],
        blockNumber,
        poolPrices![0].prices,
        amountsForSell,
        dexHelper,
        tokens[srcTokenSymbol].address,
      );
    });

    it('getPoolIdentifiers and getPricesVolume WETH -> ETHx SELL', async () => {
      const srcTokenSymbol = 'WETH';
      const destTokenSymbol = 'ETHx';

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

      const pools = await stader.getPoolIdentifiers(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await stader.getPricesVolume(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        amountsForSell,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(
        `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amountsForSell, SwapSide.SELL, dexKey);

      // Check if onchain pricing equals to calculated ones
      await checkOnChainPricing(
        stader,
        'previewDeposit',
        poolPrices![0].poolAddresses![0],
        blockNumber,
        poolPrices![0].prices,
        amountsForSell,
        dexHelper,
        tokens[srcTokenSymbol].address,
      );
    });

    it('ETH getTopPoolsForToken', async function () {
      const poolLiquidity = await stader.getTopPoolsForToken(
        tokens['ETH'].address,
        10,
      );
      console.log(`ETH Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, tokens['ETH'].address, dexKey);
    });

    it('WETH getTopPoolsForToken', async function () {
      const poolLiquidity = await stader.getTopPoolsForToken(
        tokens['WETH'].address,
        10,
      );
      console.log(`WETH Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, tokens['WETH'].address, dexKey);
    });

    it('ETHx getTopPoolsForToken', async function () {
      const poolLiquidity = await stader.getTopPoolsForToken(
        tokens['ETHx'].address,
        10,
      );
      console.log(`ETHx Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, tokens['ETHx'].address, dexKey);
    });
  });
});
