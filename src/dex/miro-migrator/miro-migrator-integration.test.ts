import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import {
  checkConstantPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { MiroMigrator } from './miro-migrator';

const amounts = [0n, BI_POWS[18], 2000000000000000000n];

const testIntegration = (
  network: Network,
  dexKey: string,
  fromSymbol: string,
  toSymbol: string,
  swapSide: SwapSide,
  amounts: bigint[],
) => {
  it(`getPoolIdentifiers and getPricesVolume ${SwapSide[swapSide]}`, async function () {
    const dexHelper = new DummyDexHelper(network);
    const migrator = new MiroMigrator(network, dexKey, dexHelper);
    const fromToken = Tokens[network][fromSymbol];
    const toToken = Tokens[network][toSymbol];
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();

    const pools = await migrator.getPoolIdentifiers(
      fromToken,
      toToken,
      swapSide,
      blocknumber,
    );
    console.log(`${fromSymbol} <> ${toSymbol} Pools:`, pools);
    expect(pools.length).toBeGreaterThan(0);

    const prices = await migrator.getPricesVolume(
      fromToken,
      toToken,
      amounts,
      swapSide,
      blocknumber,
      pools,
    );
    console.log(`${fromSymbol} <> ${toSymbol} Prices:`, prices);
    expect(prices).not.toBeNull();
    checkConstantPoolPrices(prices!, amounts, dexKey);
  });
};

const testGetTopPoolsForToken = (
  network: Network,
  dexKey: string,
  symbol: string,
  limit: number = 10,
) => {
  it(`getTopPoolsForToken ${symbol}`, async function () {
    const dexHelper = new DummyDexHelper(network);
    const migrator = new MiroMigrator(network, dexKey, dexHelper);
    const token = Tokens[network][symbol];

    const poolLiquidity = await migrator.getTopPoolsForToken(
      token.address,
      limit,
    );
    console.log(`${symbol} Top Pools:`, JSON.stringify(poolLiquidity, null, 2));

    checkPoolsLiquidity(poolLiquidity, token.address, dexKey);
  });
};

describe('MiroMigrator', function () {
  const dexKey = 'MiroMigrator';

  describe('Mainnet', function () {
    const network = Network.MAINNET;
    const fromSymbols = ['PSP', 'sePSP1'];
    const toSymbol = 'VLR';

    for (const fromSymbol of fromSymbols) {
      describe(`${fromSymbol} -> ${toSymbol}`, function () {
        testIntegration(
          network,
          dexKey,
          fromSymbol,
          toSymbol,
          SwapSide.SELL,
          amounts,
        );
        testIntegration(
          network,
          dexKey,
          fromSymbol,
          toSymbol,
          SwapSide.BUY,
          amounts,
        );
      });
    }

    fromSymbols.forEach(symbol => {
      testGetTopPoolsForToken(network, dexKey, symbol, 10);
    });
  });

  describe('Optimism', function () {
    const network = Network.OPTIMISM;
    const fromSymbols = ['PSP', 'sePSP1'];
    const toSymbol = 'VLR';

    for (const fromSymbol of fromSymbols) {
      describe(`${fromSymbol} -> ${toSymbol}`, function () {
        testIntegration(
          network,
          dexKey,
          fromSymbol,
          toSymbol,
          SwapSide.SELL,
          amounts,
        );
        testIntegration(
          network,
          dexKey,
          fromSymbol,
          toSymbol,
          SwapSide.BUY,
          amounts,
        );
      });
    }

    fromSymbols.forEach(symbol => {
      testGetTopPoolsForToken(network, dexKey, symbol, 10);
    });
  });
});
