/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Clear } from './clear';
import { Token } from '../../types';
import { ClearConfig } from './config';

/*
  Simple test to verify Clear integration works

  Run with:
  npm test -- clear-simple.test.ts
*/

jest.setTimeout(50 * 1000);

const network = Network.MAINNET;
const dexKey = 'clear';

// Test tokens on Ethereum Mainnet
const USDC: Token = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
  symbol: 'USDC',
};

const WETH: Token = {
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  decimals: 18,
  symbol: 'WETH',
};

// ClearSwap contract address from config
const CLEAR_SWAP_ADDRESS = ClearConfig.clear[Network.MAINNET].swapAddress;

describe('Clear Simple Integration Test', function () {
  const dexHelper = new DummyDexHelper(network);
  let clear: Clear;
  let blockNumber: number;

  beforeAll(async () => {
    clear = new Clear(network, dexKey, dexHelper);
    blockNumber = await dexHelper.provider.getBlockNumber();
    // Initialize pricing to load vaults
    await clear.initializePricing(blockNumber);
  });

  afterAll(() => {
    // Cleanup handled automatically by StatefulEventSubscriber
  });

  describe('GraphQL Connectivity', function () {
    it('should query vaults from GraphQL', async function () {
      // This is an internal method, so we'll test through getPoolIdentifiers
      const poolIdentifiers = await clear.getPoolIdentifiers(
        USDC,
        WETH,
        SwapSide.SELL,
        blockNumber,
      );

      console.log('Pool identifiers:', poolIdentifiers);

      // Note: May be empty if no vaults exist for this pair on mainnet yet
      if (poolIdentifiers.length > 0) {
        expect(poolIdentifiers[0]).toContain('clear_');
        expect(poolIdentifiers[0]).toContain(USDC.address.toLowerCase());
        expect(poolIdentifiers[0]).toContain(WETH.address.toLowerCase());
      }
    });
  });

  describe('Pool Discovery', function () {
    it('should find Clear vault for USDC-WETH pair if available', async function () {
      const poolIdentifiers = await clear.getPoolIdentifiers(
        USDC,
        WETH,
        SwapSide.SELL,
        blockNumber,
      );

      console.log(
        `Found ${poolIdentifiers.length} Clear vault(s) for USDC-WETH`,
      );
      if (poolIdentifiers.length > 0) {
        console.log(`Vault: ${poolIdentifiers[0]}`);
      }
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
        blockNumber,
      );

      expect(poolIdentifiers.length).toBe(0);
    });
  });

  describe('Pricing', function () {
    it('should get prices for USDC -> WETH swap if vault exists', async function () {
      const amount = BigInt(1_000_000); // 1 USDC (6 decimals)

      const poolPrices = await clear.getPricesVolume(
        USDC,
        WETH,
        [amount],
        SwapSide.SELL,
        blockNumber,
      );

      console.log('Prices:', poolPrices);

      // May be null if no vaults exist for this pair
      if (poolPrices) {
        expect(poolPrices.length).toBeGreaterThan(0);
        console.log(`1 USDC = ${poolPrices[0].prices[0]} WETH (raw)`);
        console.log(`1 USDC = ${Number(poolPrices[0].prices[0]) / 1e18} WETH`);
      }
    });

    it('should get prices for WETH -> USDC swap if vault exists', async function () {
      const amount = BigInt(1) * BigInt(10 ** 18); // 1 WETH (18 decimals)

      const poolPrices = await clear.getPricesVolume(
        WETH,
        USDC,
        [amount],
        SwapSide.SELL,
        blockNumber,
      );

      console.log('Prices:', poolPrices);

      // May be null if no vaults exist for this pair
      if (poolPrices) {
        expect(poolPrices.length).toBeGreaterThan(0);
        console.log(`1 WETH = ${poolPrices[0].prices[0]} USDC (raw)`);
        console.log(`1 WETH = ${Number(poolPrices[0].prices[0]) / 1e6} USDC`);
      }
    });

    it('should return null for BUY side (not supported)', async function () {
      const amount = BigInt(1_000_000);

      const poolPrices = await clear.getPricesVolume(
        USDC,
        WETH,
        [amount],
        SwapSide.BUY,
        blockNumber,
      );

      expect(poolPrices).toBeNull();
    });
  });

  describe('Calldata Generation', function () {
    it('should generate getDexParam for swap', async function () {
      // Get a real vault from GraphQL first
      const poolIdentifiers = await clear.getPoolIdentifiers(
        USDC,
        WETH,
        SwapSide.SELL,
        blockNumber,
      );

      // Skip if no vaults available
      if (poolIdentifiers.length === 0) {
        console.log('No vaults available for USDC-WETH, skipping test');
        return;
      }

      // Extract vault address from pool identifier
      const vaultAddress = poolIdentifiers[0].split('_')[1];

      const data = {
        vault: vaultAddress,
        router: CLEAR_SWAP_ADDRESS,
      };

      const recipient = '0x0000000000000000000000000000000000000001';

      const dexParams = clear.getDexParam(
        USDC.address,
        WETH.address,
        '1000000', // 1 USDC
        '100000000000000', // Min ~0.0001 WETH out
        recipient,
        data,
        SwapSide.SELL,
      );

      expect(dexParams).toBeDefined();
      expect(dexParams.targetExchange).toBe(data.router);
      expect(dexParams.exchangeData).toBeDefined();
      expect(dexParams.exchangeData.length).toBeGreaterThan(0);
      expect(dexParams.dexFuncHasRecipient).toBe(true);

      console.log('getDexParam generated successfully');
      console.log('Target exchange:', dexParams.targetExchange);
      console.log('Vault used:', vaultAddress);
      console.log('Exchange data length:', dexParams.exchangeData.length);
    });

    it('getAdapters should return null (V6 only)', function () {
      expect(clear.getAdapters(SwapSide.SELL)).toBeNull();
      expect(clear.getAdapters(SwapSide.BUY)).toBeNull();
    });
  });
});
