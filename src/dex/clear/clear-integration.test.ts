import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Clear } from './clear';
import { Tokens } from '../../../tests/constants-e2e';

/**
 * Clear Integration Tests
 *
 * Note: Clear is a depeg arbitrage protocol. Swaps only work when tokens
 * are depegged (>0.05% difference). These tests verify the integration
 * works correctly regardless of market conditions:
 * - Pool discovery works (getPoolIdentifiers finds vaults)
 * - Pricing calls don't throw (getPricesVolume handles depeg/no-depeg)
 * - Returns null or prices based on market state
 */
describe('Clear Integration', function () {
  const dexKey = 'clear';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const tokens = Tokens[network];

  let blockNumber: number;
  let clear: Clear;

  const tokenPairs = [
    { src: 'USDC', dest: 'GHO' },
    { src: 'GHO', dest: 'USDC' },
  ];

  beforeAll(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    clear = new Clear(network, dexKey, dexHelper);
    if (clear.initializePricing) {
      await clear.initializePricing(blockNumber);
    }
  });

  afterAll(() => {
    // Cleanup handled automatically by StatefulEventSubscriber
  });

  describe('Pool Discovery', () => {
    tokenPairs.forEach(({ src, dest }) => {
      it(`should find vault for ${src} -> ${dest}`, async () => {
        const pools = await clear.getPoolIdentifiers(
          tokens[src],
          tokens[dest],
          SwapSide.SELL,
          blockNumber,
        );

        console.log(`${src} -> ${dest} pools:`, pools);

        expect(pools.length).toBeGreaterThan(0);
        expect(pools[0]).toContain('clear_');
        expect(pools[0].toLowerCase()).toContain(
          tokens[src].address.toLowerCase(),
        );
        expect(pools[0].toLowerCase()).toContain(
          tokens[dest].address.toLowerCase(),
        );
      });
    });

    it('should return empty array for unsupported pair', async () => {
      const pools = await clear.getPoolIdentifiers(
        tokens['WETH'],
        tokens['DAI'],
        SwapSide.SELL,
        blockNumber,
      );

      expect(pools.length).toBe(0);
    });
  });

  describe('Pricing', () => {
    tokenPairs.forEach(({ src, dest }) => {
      it(`should handle ${src} -> ${dest} pricing without throwing`, async () => {
        const srcToken = tokens[src];
        const amounts = [
          0n,
          1n * BI_POWS[srcToken.decimals],
          100n * BI_POWS[srcToken.decimals],
        ];

        const pools = await clear.getPoolIdentifiers(
          tokens[src],
          tokens[dest],
          SwapSide.SELL,
          blockNumber,
        );

        // Should not throw - returns null if no depeg, prices if depeg
        const prices = await clear.getPricesVolume(
          tokens[src],
          tokens[dest],
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        console.log(`${src} -> ${dest} prices:`, prices);

        // Either null (no depeg) or valid prices array
        if (prices !== null) {
          expect(prices.length).toBeGreaterThan(0);
          expect(prices[0].prices.length).toBe(amounts.length);
        }
      });
    });

    it('should return null for BUY side (not supported)', async () => {
      const prices = await clear.getPricesVolume(
        tokens['USDC'],
        tokens['GHO'],
        [0n, 1000000n],
        SwapSide.BUY,
        blockNumber,
      );

      expect(prices).toBeNull();
    });
  });
});
