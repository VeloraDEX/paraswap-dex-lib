import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { SkyConverter } from './sky-converter';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';

const network = Network.MAINNET;

const tokenAAmounts = [
  0n,
  1n * BI_POWS[18],
  2n * BI_POWS[18],
  3n * BI_POWS[18],
  4n * BI_POWS[18],
  5n * BI_POWS[18],
  6n * BI_POWS[18],
  7n * BI_POWS[18],
  8n * BI_POWS[18],
  9n * BI_POWS[18],
  10n * BI_POWS[18],
];

const tokenBAmounts = [
  0n,
  1n * BI_POWS[18],
  2n * BI_POWS[18],
  3n * BI_POWS[18],
  4n * BI_POWS[18],
  5n * BI_POWS[18],
  6n * BI_POWS[18],
  7n * BI_POWS[18],
  8n * BI_POWS[18],
  9n * BI_POWS[18],
  10n * BI_POWS[18],
];

describe('SkyConverter integration tests', () => {
  describe('DaiUsds', function () {
    const dexKey = 'DaiUsds';
    const TokenASymbol = 'DAI';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'USDS';
    const TokenB = Tokens[network][TokenBSymbol];

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const dexHelper = new DummyDexHelper(network);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const skyConverter = new SkyConverter(network, dexKey, dexHelper);

      const pools = await skyConverter.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await skyConverter.getPricesVolume(
        TokenA,
        TokenB,
        tokenAAmounts,
        SwapSide.SELL,
        blocknumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, tokenAAmounts, SwapSide.SELL, dexKey);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const dexHelper = new DummyDexHelper(network);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const skyConverter = new SkyConverter(network, dexKey, dexHelper);

      const pools = await skyConverter.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await skyConverter.getPricesVolume(
        TokenA,
        TokenB,
        tokenBAmounts,
        SwapSide.BUY,
        blocknumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, tokenBAmounts, SwapSide.BUY, dexKey);
    });

    it('getTopPoolsForToken', async function () {
      const dexHelper = new DummyDexHelper(network);
      const skyConverter = new SkyConverter(network, dexKey, dexHelper);

      const poolLiquidity = await skyConverter.getTopPoolsForToken(
        TokenA.address,
        10,
      );
      console.log(
        `${TokenASymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
    });
  });

  describe('MkrSky', function () {
    const dexKey = 'MkrSky';
    const TokenASymbol = 'MKR';
    const TokenA = Tokens[network][TokenASymbol];

    const TokenBSymbol = 'SKY';
    const TokenB = Tokens[network][TokenBSymbol];

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const dexHelper = new DummyDexHelper(network);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const skyConverter = new SkyConverter(network, dexKey, dexHelper);

      const pools = await skyConverter.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await skyConverter.getPricesVolume(
        TokenA,
        TokenB,
        tokenAAmounts,
        SwapSide.SELL,
        blocknumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, tokenAAmounts, SwapSide.SELL, dexKey);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const dexHelper = new DummyDexHelper(network);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const skyConverter = new SkyConverter(network, dexKey, dexHelper);

      const pools = await skyConverter.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await skyConverter.getPricesVolume(
        TokenA,
        TokenB,
        tokenBAmounts,
        SwapSide.BUY,
        blocknumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, tokenBAmounts, SwapSide.BUY, dexKey);
    });

    it('getTopPoolsForToken', async function () {
      const dexHelper = new DummyDexHelper(network);
      const skyConverter = new SkyConverter(network, dexKey, dexHelper);

      const poolLiquidity = await skyConverter.getTopPoolsForToken(
        TokenA.address,
        10,
      );
      console.log(
        `${TokenASymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
    });
  });
});
