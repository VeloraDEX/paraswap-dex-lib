/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { checkPoolsLiquidity } from '../../../tests/utils';
import { GIFTER_ADDRESS } from '../../../tests/constants-e2e';
import { Token, ExchangePrices } from '../../types';
import { AavePtToUsdcData } from './types';
import { DummyDexHelper } from '../../dex-helper/dummy-dex-helper';
import { Network, SwapSide } from '../../constants';
import { AavePtToUsdc } from './aave-pt-to-usdc';
import { AavePtToUsdcConfig } from './config';

const dexKey = 'AavePtToUsdc';

// A simple price check utility
const checkPricesAreValid = (
  poolPrices: ExchangePrices<AavePtToUsdcData> | null,
  amounts: bigint[],
) => {
  expect(poolPrices).not.toBeNull();
  expect(poolPrices!.length).toBeGreaterThan(0);
  const prices = poolPrices![0].prices;
  expect(prices.length).toBe(amounts.length);
  if (prices.length > 1) {
    expect(prices[1]).toBeGreaterThan(0n);
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const amounts = [0n, 10n * 10n ** 18n];
const JEST_TIMEOUT = 90000; // 90 seconds, to be safe with delays

describe('AavePtToUsdc', () => {
  describe('Mainnet', () => {
    let aavePtToUsdc: AavePtToUsdc;
    let blockNumber = 0;
    const ptSusdeToken: Token = {
      address: '0x9f56094c450763769ba0ea9fe2876070c0fd5f77',
      decimals: 18,
      symbol: 'PT-sUSDe-25SEP2025',
    };
    const ptUsdeToken: Token = {
      address: '0xbc6736d346a5ebc0debc997397912cd9b8fae10a',
      decimals: 18,
      symbol: 'PT-USDe-31JUL2025',
    };
    const usdcToken: Token = {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
      symbol: 'USDC',
    };
    const sUsdeToken: Token = {
      address: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
      decimals: 18,
      symbol: 'sUSDe',
    };

    const usdeToken: Token = {
      address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
      decimals: 18,
      symbol: 'USDe',
    };

    beforeAll(async () => {
      const network = Network.MAINNET;
      const rpcUrl =
        process.env.HTTP_PROVIDER_1 || 'https://eth.public-rpc.com';
      const dexHelper = new DummyDexHelper(network, rpcUrl);
      (dexHelper.config as any).data = {
        ...AavePtToUsdcConfig.AavePtToUsdc[network],
        network,
        augustusAddress: GIFTER_ADDRESS,
      };
      aavePtToUsdc = new AavePtToUsdc(network, dexKey, dexHelper);
      await aavePtToUsdc.initializePricing(blockNumber);
    });

    beforeEach(async () => {
      await sleep(8000); // Wait 8 seconds before each test
    });

    it(
      'getPoolIdentifiers and getPricesVolume SELL PT -> USDC',
      async () => {
        const pools = await aavePtToUsdc.getPoolIdentifiers(
          ptSusdeToken,
          usdcToken,
          SwapSide.SELL,
          blockNumber,
        );
        const poolPrices = await aavePtToUsdc.getPricesVolume(
          ptSusdeToken,
          usdcToken,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${ptSusdeToken.symbol} <> ${usdcToken.symbol} Pool Prices: `,
          poolPrices,
        );
        checkPricesAreValid(poolPrices, amounts);
      },
      JEST_TIMEOUT,
    );

    it(
      'getPoolIdentifiers and getPricesVolume SELL PT -> underlying asset',
      async () => {
        const pools = await aavePtToUsdc.getPoolIdentifiers(
          ptSusdeToken,
          sUsdeToken,
          SwapSide.SELL,
          blockNumber,
        );
        const poolPrices = await aavePtToUsdc.getPricesVolume(
          ptSusdeToken,
          sUsdeToken,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${ptSusdeToken.symbol} <> ${sUsdeToken.symbol} Pool Prices: `,
          poolPrices,
        );
        checkPricesAreValid(poolPrices, amounts);
      },
      JEST_TIMEOUT,
    );

    it(
      'getTopPoolsForToken',
      async () => {
        const poolLiquidity = await aavePtToUsdc.getTopPoolsForToken(
          ptSusdeToken.address,
          1,
        );
        console.log(`${ptSusdeToken.symbol} Top Pools:`, poolLiquidity);
        checkPoolsLiquidity(poolLiquidity, ptSusdeToken.address, dexKey);
      },
      JEST_TIMEOUT,
    );

    // Note: PT-eUSDe-14AUG2025 token removed from config

    // Test PT-USDe-31JUL2025
    it(
      'PT-USDe-31JUL2025 getPoolIdentifiers and getPricesVolume SELL PT -> USDC',
      async () => {
        const pools = await aavePtToUsdc.getPoolIdentifiers(
          ptUsdeToken,
          usdcToken,
          SwapSide.SELL,
          blockNumber,
        );
        const poolPrices = await aavePtToUsdc.getPricesVolume(
          ptUsdeToken,
          usdcToken,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${ptUsdeToken.symbol} <> ${usdcToken.symbol} Pool Prices: `,
          poolPrices,
        );
        checkPricesAreValid(poolPrices, amounts);
      },
      JEST_TIMEOUT,
    );

    it(
      'PT-USDe-31JUL2025 getPoolIdentifiers and getPricesVolume SELL PT -> underlying asset',
      async () => {
        const pools = await aavePtToUsdc.getPoolIdentifiers(
          ptUsdeToken,
          usdeToken,
          SwapSide.SELL,
          blockNumber,
        );
        const poolPrices = await aavePtToUsdc.getPricesVolume(
          ptUsdeToken,
          usdeToken,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );
        console.log(
          `${ptUsdeToken.symbol} <> ${usdeToken.symbol} Pool Prices: `,
          poolPrices,
        );
        checkPricesAreValid(poolPrices, amounts);
      },
      JEST_TIMEOUT,
    );
  });
});
