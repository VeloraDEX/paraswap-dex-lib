import dotenv from 'dotenv';
dotenv.config();
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { checkPoolsLiquidity } from '../../../tests/utils';
import { CurveV1StableNg } from './curve-v1-stable-ng';
import { testPricingOnNetwork } from '../curve-v1-factory/curve-v1-factory-integration.test';
import CurveV1StableNgPoolAbi from '../../abi/curve-v1/CurveV1StableNg.json';
import { Interface, JsonFragment } from '@ethersproject/abi';

describe('CurveV1StableNG integration', function () {
  const dexKey = 'CurveV1StableNg';

  const readerIface = new Interface(CurveV1StableNgPoolAbi as JsonFragment[]);

  let blockNumber: number;
  let curveV1StableNg: CurveV1StableNg;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      console.log(
        `Received blockNumber ${blockNumber} on network ${dexHelper.config.data.network}`,
      );
      curveV1StableNg = new CurveV1StableNg(network, dexKey, dexHelper);
      if (curveV1StableNg.initializePricing) {
        await curveV1StableNg.initializePricing(blockNumber);
      }
    });

    describe('GHO -> USDe', () => {
      const srcTokenSymbol = 'GHO';
      const destTokenSymbol = 'USDe';
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

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1StableNG = new CurveV1StableNg(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1StableNG.updatePoolState) {
          await newCurveV1StableNG.updatePoolState();
        }
        const poolLiquidity = await newCurveV1StableNG.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1StableNG.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      console.log(
        `Received blockNumber ${blockNumber} on network ${dexHelper.config.data.network}`,
      );
      curveV1StableNg = new CurveV1StableNg(network, dexKey, dexHelper);
      if (curveV1StableNg.initializePricing) {
        await curveV1StableNg.initializePricing(blockNumber);
      }
    });

    describe('crvUSD -> USDT', () => {
      const srcTokenSymbol = 'crvUSD';
      const destTokenSymbol = 'USDT';
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

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1StableNG = new CurveV1StableNg(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1StableNG.updatePoolState) {
          await newCurveV1StableNG.updatePoolState();
        }
        const poolLiquidity = await newCurveV1StableNG.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1StableNG.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      console.log(
        `Received blockNumber ${blockNumber} on network ${dexHelper.config.data.network}`,
      );
      curveV1StableNg = new CurveV1StableNg(network, dexKey, dexHelper);
      if (curveV1StableNg.initializePricing) {
        await curveV1StableNg.initializePricing(blockNumber);
      }
    });

    describe('WXDAI -> USDC', () => {
      const srcTokenSymbol = 'WXDAI';
      const destTokenSymbol = 'USDC';
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

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1StableNG = new CurveV1StableNg(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1StableNG.updatePoolState) {
          await newCurveV1StableNG.updatePoolState();
        }
        const poolLiquidity = await newCurveV1StableNG.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1StableNG.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      console.log(
        `Received blockNumber ${blockNumber} on network ${dexHelper.config.data.network}`,
      );
      curveV1StableNg = new CurveV1StableNg(network, dexKey, dexHelper);
      if (curveV1StableNg.initializePricing) {
        await curveV1StableNg.initializePricing(blockNumber);
      }
    });

    describe('crvUSD -> USDCe', () => {
      const srcTokenSymbol = 'crvUSD';
      const destTokenSymbol = 'USDCe';
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

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1StableNG = new CurveV1StableNg(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1StableNG.updatePoolState) {
          await newCurveV1StableNG.updatePoolState();
        }
        const poolLiquidity = await newCurveV1StableNG.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1StableNG.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(
            poolLiquidity,
            Tokens[network][srcTokenSymbol].address,
            dexKey,
          );
        }
      });
    });
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      // @ts-expect-error for testing there is dummy blocknumber, but it is not
      // part of the interface
      dexHelper.blockManager._blockNumber = blockNumber;
      console.log(
        `Received blockNumber ${blockNumber} on network ${dexHelper.config.data.network}`,
      );
      curveV1StableNg = new CurveV1StableNg(network, dexKey, dexHelper);
      if (curveV1StableNg.initializePricing) {
        await curveV1StableNg.initializePricing(blockNumber);
      }
    });

    describe('crvUSD -> USDC', () => {
      const srcTokenSymbol = 'crvUSD';
      const destTokenSymbol = 'USDC';
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

      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'get_dy',
          readerIface,
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        console.log('amountsForBuy: ', amountsForBuy);

        await testPricingOnNetwork(
          curveV1StableNg,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForBuy,
          'get_dx',
          readerIface,
        );
      });

      it('getTopPoolsForToken', async function () {
        // We have to check without calling initializePricing, because
        // pool-tracker is not calling that function
        const newCurveV1StableNG = new CurveV1StableNg(
          network,
          dexKey,
          dexHelper,
        );
        if (newCurveV1StableNG.updatePoolState) {
          await newCurveV1StableNG.updatePoolState();
        }
        const poolLiquidity = await newCurveV1StableNG.getTopPoolsForToken(
          tokens[srcTokenSymbol].address,
          10,
        );
        console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

        if (!newCurveV1StableNG.hasConstantPriceLargeAmounts) {
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
