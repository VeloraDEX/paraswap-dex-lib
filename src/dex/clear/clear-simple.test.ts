/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Clear } from './clear';
import { Token } from '../../types';

/*
  Simple test to verify Clear integration works

  Run with:
  npm test -- clear-simple.test.ts
*/

jest.setTimeout(50 * 1000);

const network = Network.ARBITRUM_SEPOLIA;
const dexKey = 'clear';

// Test tokens from the vault we discovered
const USDC: Token = {
  address: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
  decimals: 6,
  symbol: 'USDC',
};

const GHO: Token = {
  address: '0x69cac783c212bfae06e3c1a9a2e6ae6b17ba0614',
  decimals: 18,
  symbol: 'GHO',
};

const VAULT_ADDRESS = '0x1cfb48224ef579a11b98126151584eecb0e47960';

describe('Clear Simple Integration Test', function () {
  const dexHelper = new DummyDexHelper(network);
  let clear: Clear;

  beforeAll(async () => {
    clear = new Clear(network, dexKey, dexHelper);
  });

  describe('GraphQL Connectivity', function () {
    it('should query vaults from GraphQL', async function () {
      // This is an internal method, so we'll test through getPoolIdentifiers
      const poolIdentifiers = await clear.getPoolIdentifiers(
        USDC,
        GHO,
        SwapSide.SELL,
        0,
      );

      console.log('Pool identifiers:', poolIdentifiers);

      expect(poolIdentifiers.length).toBeGreaterThan(0);
      expect(poolIdentifiers[0]).toContain(VAULT_ADDRESS.toLowerCase());
      expect(poolIdentifiers[0]).toContain(USDC.address.toLowerCase());
      expect(poolIdentifiers[0]).toContain(GHO.address.toLowerCase());
    });
  });

  describe('Pool Discovery', function () {
    it('should find Clear vault for USDC-GHO pair', async function () {
      const poolIdentifiers = await clear.getPoolIdentifiers(
        USDC,
        GHO,
        SwapSide.SELL,
        await dexHelper.provider.getBlockNumber(),
      );

      expect(poolIdentifiers.length).toBeGreaterThan(0);

      console.log(`Found ${poolIdentifiers.length} Clear vault(s) for USDC-GHO`);
      console.log(`Vault: ${poolIdentifiers[0]}`);
    });

    it('should return empty array for non-existent pair', async function () {
      const FakeToken1: Token = {
        address: '0x1111111111111111111111111111111111111111',
        decimals: 18,
        symbol: 'FAKE1',
      };

      const FakeToken2: Token = {
        address: '0x2222222222222222222222222222222222222222',
        decimals: 18,
        symbol: 'FAKE2',
      };

      const poolIdentifiers = await clear.getPoolIdentifiers(
        FakeToken1,
        FakeToken2,
        SwapSide.SELL,
        await dexHelper.provider.getBlockNumber(),
      );

      expect(poolIdentifiers.length).toBe(0);
    });
  });

  describe('Pricing', function () {
    it('should get prices for USDC -> GHO swap', async function () {
      const blockNumber = await dexHelper.provider.getBlockNumber();
      const amount = BigInt(1_000_000); // 1 USDC (6 decimals)

      const poolPrices = await clear.getPricesVolume(
        USDC,
        GHO,
        [amount],
        SwapSide.SELL,
        blockNumber,
      );

      console.log('Prices:', poolPrices);

      expect(poolPrices).not.toBeNull();
      expect(poolPrices!.length).toBeGreaterThan(0);
      expect(poolPrices![0].prices[0]).toBeGreaterThan(0n);

      console.log(`1 USDC = ${poolPrices![0].prices[0]} GHO (raw)`);
      console.log(
        `1 USDC = ${Number(poolPrices![0].prices[0]) / 1e18} GHO`,
      );
    });

    it('should get prices for GHO -> USDC swap', async function () {
      const blockNumber = await dexHelper.provider.getBlockNumber();
      const amount = BigInt(1) * BigInt(10 ** 18); // 1 GHO (18 decimals)

      const poolPrices = await clear.getPricesVolume(
        GHO,
        USDC,
        [amount],
        SwapSide.SELL,
        blockNumber,
      );

      console.log('Prices:', poolPrices);

      expect(poolPrices).not.toBeNull();
      expect(poolPrices!.length).toBeGreaterThan(0);
      expect(poolPrices![0].prices[0]).toBeGreaterThan(0n);

      console.log(`1 GHO = ${poolPrices![0].prices[0]} USDC (raw)`);
      console.log(
        `1 GHO = ${Number(poolPrices![0].prices[0]) / 1e6} USDC`,
      );
    });

    it('should get prices for multiple amounts', async function () {
      const blockNumber = await dexHelper.provider.getBlockNumber();
      const amounts = [
        BigInt(1_000_000), // 1 USDC
        BigInt(10_000_000), // 10 USDC
        BigInt(100_000_000), // 100 USDC
      ];

      const poolPrices = await clear.getPricesVolume(
        USDC,
        GHO,
        amounts,
        SwapSide.SELL,
        blockNumber,
      );

      expect(poolPrices).not.toBeNull();
      expect(poolPrices![0].prices.length).toBe(3);

      console.log('Prices for multiple amounts:');
      amounts.forEach((amt, i) => {
        console.log(
          `  ${Number(amt) / 1e6} USDC = ${Number(poolPrices![0].prices[i]) / 1e18} GHO`,
        );
      });
    });
  });

  describe('Calldata Generation', function () {
    it('should generate adapter params for swap', async function () {
      const data = {
        vault: VAULT_ADDRESS,
        router: '0x5B69f9D067077c3FBb22Bd732d2c34A9731fC162', // ClearSwap address
      };

      const adapterParams = clear.getAdapterParam(
        USDC.address,
        GHO.address,
        '1000000', // 1 USDC
        '900000000000000000', // Min 0.9 GHO out
        data,
        SwapSide.SELL,
      );

      expect(adapterParams).toBeDefined();
      expect(adapterParams.targetExchange).toBe(data.router);
      expect(adapterParams.payload).toBeDefined();
      expect(adapterParams.payload.length).toBeGreaterThan(0);

      console.log('Adapter params generated successfully');
      console.log('Target exchange:', adapterParams.targetExchange);
      console.log('Payload length:', adapterParams.payload.length);
    });
  });
});
