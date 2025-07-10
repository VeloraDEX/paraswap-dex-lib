/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { getDexKeysWithNetwork } from '../../utils';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { GIFTER_ADDRESS, Tokens } from '../../../tests/constants-e2e';
import { Token } from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AavePtToUsdcData } from './types';

import { DummyDexHelper } from '../../dex-helper/dummy-dex-helper';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AavePtToUsdc } from './aave-pt-to-usdc';
import { AavePtToUsdcConfig } from './config';

const dexKey = 'AavePtToUsdc';

const PT_SUSDE_TOKEN: Token = {
  address: '0x3b3fb9c57858ef816833dc91565efcd85d96f634',
  decimals: 18,
  symbol: 'PT-sUSDe-31JUL2025',
};

const USDC_TOKEN: Token = {
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
  symbol: 'USDC',
};

const SUSDE_TOKEN: Token = {
  address: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
  decimals: 18,
  symbol: 'sUSDe',
};

const amounts = [0n, 10n * 10n ** 18n, 100n * 10n ** 18n];

describe('AavePtToUsdc', () => {
  describe('Mainnet', () => {
    let aavePtToUsdc: AavePtToUsdc;
    let blockNumber = 0; // Not used by this dex, but required by interfaces
    const ptSusdeToken: Token = {
      address: '0x3b3fb9c57858ef816833dc91565efcd85d96f634',
      decimals: 18,
      symbol: 'PT-sUSDe-31JUL2025',
    };
    const sUsdeToken: Token = {
      address: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // sUSDe
      decimals: 18,
      symbol: 'sUSDe',
    };

    beforeAll(() => {
      const network = Network.MAINNET;
      const rpcUrl = 'https://rpc.ankr.com/eth';
      const dexHelper = new DummyDexHelper(network, rpcUrl);
      (dexHelper.config as any).data = {
        ...AavePtToUsdcConfig.AavePtToUsdc[network],
        network,
        augustusAddress: GIFTER_ADDRESS, // Dummy address
      };
      aavePtToUsdc = new AavePtToUsdc(dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async () => {
      const pools = await aavePtToUsdc.getPoolIdentifiers(
        ptSusdeToken,
        sUsdeToken,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(
        `${ptSusdeToken.symbol} <> ${sUsdeToken.symbol} Pool Identifiers: `,
        pools,
      );
      expect(pools.length).toBeGreaterThan(0);

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
      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async () => {
      const pools = await aavePtToUsdc.getPoolIdentifiers(
        sUsdeToken,
        ptSusdeToken,
        SwapSide.BUY,
        blockNumber,
      );
      console.log(
        `${sUsdeToken.symbol} <> ${ptSusdeToken.symbol} Pool Identifiers: `,
        pools,
      );
      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await aavePtToUsdc.getPricesVolume(
        sUsdeToken,
        ptSusdeToken,
        amounts,
        SwapSide.BUY,
        blockNumber,
        pools,
      );
      console.log(
        `${sUsdeToken.symbol} <> ${ptSusdeToken.symbol} Pool Prices: `,
        poolPrices,
      );
      expect(poolPrices).toBeNull();
    });

    it('getTopPoolsForToken', async () => {
      const rpcUrl = 'https://rpc.ankr.com/eth';
      const network = Network.MAINNET;
      const dexHelper = new DummyDexHelper(network, rpcUrl);
      (dexHelper.config as any).data = {
        ...AavePtToUsdcConfig.AavePtToUsdc[network],
        network,
        augustusAddress: GIFTER_ADDRESS, // Dummy address
      };
      const newAavePtToUsdc = new AavePtToUsdc(dexHelper);
      if (newAavePtToUsdc.updatePoolState) {
        await newAavePtToUsdc.updatePoolState();
      }
      const poolLiquidity = await newAavePtToUsdc.getTopPoolsForToken(
        ptSusdeToken.address,
        1,
      );
      console.log(`${ptSusdeToken.symbol} Top Pools:`, poolLiquidity);

      if (!newAavePtToUsdc.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(poolLiquidity, ptSusdeToken.address, dexKey);
      }
    });
  });
});
