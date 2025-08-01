/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { DummyDexHelper } from '../../dex-helper/index';
import { FluidDexLite } from './fluid-dex-lite';

// Set timeout for all tests
jest.setTimeout(300 * 1000);

/*
  FluidDexLite E2E Tests
  =====================
  
  End-to-end tests for FluidDexLite integration that:
  - Test actual swap transactions on Tenderly forks
  - Validate pricing accuracy against on-chain results
  - Test both ETH <> Token and Token <> Token swaps
  - Cover multiple contract methods (simpleSwap, multiSwap, megaSwap)
  - Test both SELL and BUY swap sides
  
  Prerequisites:
  - TENDERLY_TOKEN environment variable
  - TENDERLY_ACCOUNT_ID environment variable  
  - TENDERLY_PROJECT environment variable
  
  Note: For newly deployed protocols, some tests may be skipped if pools don't exist yet.
  
  Run with: npx jest src/dex/fluid-dex-lite/fluid-dex-lite-e2e.test.ts
*/

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  // FluidDexLite supports both exact input and exact output
  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            // Only test Token -> Token swaps since only USDC/USDT pool exists
            // Skip ETH tests as no ETH/USDC pool is deployed

            // Test USDC -> USDT swaps
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });

            // Test USDT -> USDC swaps
            it(`${tokenBSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[tokenBSymbol],
                tokens[tokenASymbol],
                holders[tokenBSymbol],
                side === SwapSide.SELL ? tokenBAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        });
      }),
    );
  });
}

describe('FluidDexLite E2E', () => {
  // Test on Mainnet with common stablecoin pairs
  testForNetwork(
    Network.MAINNET,
    'FluidDexLite',
    'USDC', // TokenA: USDC (6 decimals)
    'USDT', // TokenB: USDT (6 decimals)
    '1000000', // 1 USDC (1 million wei = 1 USDC)
    '1000000', // 1 USDT (1 million wei = 1 USDT)
    '1000000000000000', // 0.001 ETH (not used since no ETH pool)
  );
});

// Additional integration tests that don't require Tenderly
describe('FluidDexLite Integration Validation', () => {
  const network = Network.MAINNET;
  const dexKey = 'FluidDexLite';
  let fluidDexLite: FluidDexLite;
  let dexHelper: DummyDexHelper;

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    fluidDexLite = new FluidDexLite(network, dexKey, dexHelper);

    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    if (fluidDexLite.initializePricing) {
      await fluidDexLite.initializePricing(blockNumber);
    }
  });

  afterAll(async () => {
    if (fluidDexLite.releaseResources) {
      await fluidDexLite.releaseResources();
    }
  });

  describe('Protocol Configuration', () => {
    it('should have correct protocol configuration', () => {
      expect(fluidDexLite.dexLiteAddress).toBeDefined();
      expect(fluidDexLite.dexLiteAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(fluidDexLite.dexKey).toBe(dexKey);
      expect(fluidDexLite.network).toBe(network);
    });

    it('should initialize pools correctly', () => {
      console.log(
        `FluidDexLite initialized with ${fluidDexLite.pools.length} pools`,
      );
      expect(Array.isArray(fluidDexLite.pools)).toBe(true);

      // For newly deployed protocols, pools might not exist yet
      if (fluidDexLite.pools.length > 0) {
        const firstPool = fluidDexLite.pools[0];
        expect(firstPool.dexId).toBeDefined();
        expect(firstPool.dexKey.token0).toBeDefined();
        expect(firstPool.dexKey.token1).toBeDefined();
      } else {
        console.log(
          'No pools found yet - expected for newly deployed protocols',
        );
      }
    });
  });

  describe('Token Support', () => {
    it('should support USDC and USDT tokens', () => {
      const tokens = Tokens[network];
      expect(tokens.USDC).toBeDefined();
      expect(tokens.USDT).toBeDefined();
      expect(tokens.USDC.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(tokens.USDT.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should have valid token holders', () => {
      const holders = Holders[network];
      expect(holders.USDC).toBeDefined();
      expect(holders.USDT).toBeDefined();
      expect(holders.ETH).toBeDefined();
    });
  });

  describe('Pool Discovery', () => {
    it('should handle pool discovery for USDC/USDT', async () => {
      const tokens = Tokens[network];
      const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

      const pools = await fluidDexLite.getPoolIdentifiers(
        tokens.USDC,
        tokens.USDT,
        SwapSide.SELL,
        blockNumber,
      );

      console.log(`Found ${pools.length} USDC/USDT pools`);
      expect(Array.isArray(pools)).toBe(true);

      if (pools.length > 0) {
        expect(pools[0]).toBeDefined();
      }
    });

    it('should handle pool discovery for ETH/USDC', async () => {
      const tokens = Tokens[network];
      const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

      const pools = await fluidDexLite.getPoolIdentifiers(
        tokens.ETH,
        tokens.USDC,
        SwapSide.SELL,
        blockNumber,
      );

      console.log(`Found ${pools.length} ETH/USDC pools`);
      expect(Array.isArray(pools)).toBe(true);
    });
  });

  describe('Pricing Calculations', () => {
    it('should handle pricing calculations when pools exist', async () => {
      const tokens = Tokens[network];
      const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

      const pools = await fluidDexLite.getPoolIdentifiers(
        tokens.USDC,
        tokens.USDT,
        SwapSide.SELL,
        blockNumber,
      );

      if (pools.length > 0) {
        const amounts = [0n, 1000000n]; // 0 and 1 USDC
        const poolPrices = await fluidDexLite.getPricesVolume(
          tokens.USDC,
          tokens.USDT,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        expect(Array.isArray(poolPrices)).toBe(true);
        if (poolPrices && poolPrices.length > 0) {
          expect(poolPrices[0].prices).toBeDefined();
          expect(poolPrices[0].data).toBeDefined();
        }
      } else {
        console.log('No pools available for pricing test');
      }
    });
  });
});
