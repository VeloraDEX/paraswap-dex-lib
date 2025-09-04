/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Yo } from './yo';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Token } from '../../types';

describe('Yo', () => {
  let yoETH: Yo;
  let yoUSD: Yo;
  let dexHelper: DummyDexHelper;

  const mockVault = '0x1234567890123456789012345678901234567890';
  const mockAsset = '0x0987654321098765432109876543210987654321';

  beforeEach(() => {
    dexHelper = new DummyDexHelper(Network.BASE);
    yoETH = new Yo(Network.BASE, 'yoETH', dexHelper, mockVault, mockAsset);
    yoUSD = new Yo(Network.BASE, 'yoUSD', dexHelper, mockVault, mockAsset);
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(yoETH.dexKey).toBe('yoETH');
      expect(yoETH.network).toBe(Network.BASE);
      expect(yoETH.vault).toBe(mockVault);
      expect(yoETH.asset).toBe(mockAsset);
      expect(yoETH.cooldownEnabled).toBe(false);
    });
  });

  describe('isAppropriatePair', () => {
    it('should return true for asset -> vault pair', () => {
      const assetToken: Token = { address: mockAsset, decimals: 18 };
      const vaultToken: Token = { address: mockVault, decimals: 18 };

      expect(yoETH.isAppropriatePair(assetToken, vaultToken)).toBe(true);
    });

    it('should return true for vault -> asset pair', () => {
      const assetToken: Token = { address: mockAsset, decimals: 18 };
      const vaultToken: Token = { address: mockVault, decimals: 18 };

      expect(yoETH.isAppropriatePair(vaultToken, assetToken)).toBe(true);
    });

    it('should return false for asset -> asset pair', () => {
      const assetToken1: Token = { address: mockAsset, decimals: 18 };
      const assetToken2: Token = {
        address: '0x1111111111111111111111111111111111111111',
        decimals: 18,
      };

      expect(yoETH.isAppropriatePair(assetToken1, assetToken2)).toBe(false);
    });

    it('should return false for vault -> vault pair', () => {
      const vaultToken1: Token = { address: mockVault, decimals: 18 };
      const vaultToken2: Token = {
        address: '0x2222222222222222222222222222222222222222',
        decimals: 18,
      };

      expect(yoETH.isAppropriatePair(vaultToken1, vaultToken2)).toBe(false);
    });
  });

  describe('isAsset and isVault', () => {
    it('should correctly identify asset', () => {
      expect(yoETH.isAsset(mockAsset)).toBe(true);
      expect(yoETH.isAsset(mockVault)).toBe(false);
    });

    it('should correctly identify vault', () => {
      expect(yoETH.isVault(mockVault)).toBe(true);
      expect(yoETH.isVault(mockAsset)).toBe(false);
    });
  });

  describe('isWrap', () => {
    const assetToken: Token = { address: mockAsset, decimals: 18 };
    const vaultToken: Token = { address: mockVault, decimals: 18 };

    it('should return true for asset -> vault SELL', () => {
      expect(yoETH.isWrap(assetToken, vaultToken, SwapSide.SELL)).toBe(true);
    });

    it('should return false for vault -> asset SELL', () => {
      expect(yoETH.isWrap(vaultToken, assetToken, SwapSide.SELL)).toBe(false);
    });

    it('should return false for asset -> vault BUY', () => {
      expect(yoETH.isWrap(assetToken, vaultToken, SwapSide.BUY)).toBe(false);
    });

    it('should return true for vault -> asset BUY', () => {
      expect(yoETH.isWrap(vaultToken, assetToken, SwapSide.BUY)).toBe(true);
    });
  });

  describe('getPoolIdentifiers', () => {
    it('should return correct pool identifiers for appropriate pairs', async () => {
      const assetToken: Token = { address: mockAsset, decimals: 18 };
      const vaultToken: Token = { address: mockVault, decimals: 18 };

      const pools = await yoETH.getPoolIdentifiers(
        assetToken,
        vaultToken,
        SwapSide.SELL,
        12345678,
      );

      expect(pools).toEqual([
        'yoETH_0x1234567890123456789012345678901234567890',
      ]);
    });

    it('should return empty array for inappropriate pairs', async () => {
      const assetToken1: Token = { address: mockAsset, decimals: 18 };
      const assetToken2: Token = {
        address: '0x1111111111111111111111111111111111111111',
        decimals: 18,
      };

      const pools = await yoETH.getPoolIdentifiers(
        assetToken1,
        assetToken2,
        SwapSide.SELL,
        12345678,
      );

      expect(pools).toEqual([]);
    });
  });

  describe('Preview functions', () => {
    const mockState = {
      totalAssets: 1000000000000000000000n, // 1000 assets
      totalShares: 1000000000000000000000n, // 1000 shares
    };

    describe('previewDeposit', () => {
      it('should calculate correct shares for deposit', () => {
        const assets = 100000000000000000000n; // 100 assets
        const shares = yoETH.previewDeposit(assets, mockState);

        // Should get 100 shares for 100 assets (1:1 ratio)
        expect(shares).toBe(100000000000000000000n);
      });
    });

    describe('previewRedeem', () => {
      it('should calculate correct assets for redeem', () => {
        const shares = 100000000000000000000n; // 100 shares
        const assets = yoETH.previewRedeem(shares, mockState);

        // Should get 100 assets for 100 shares (1:1 ratio)
        expect(assets).toBe(100000000000000000000n);
      });
    });

    describe('previewMint', () => {
      it('should calculate correct assets for mint', () => {
        const shares = 100000000000000000000n; // 100 shares
        const assets = yoETH.previewMint(shares, mockState);

        // Should need 100 assets to mint 100 shares (1:1 ratio)
        expect(assets).toBe(100000000000000000000n);
      });
    });

    describe('previewWithdraw', () => {
      it('should calculate correct shares for withdraw', () => {
        const assets = 100000000000000000000n; // 100 assets
        const shares = yoETH.previewWithdraw(assets, mockState);

        // Should need 100 shares to withdraw 100 assets (1:1 ratio)
        expect(shares).toBe(100000000000000000000n);
      });
    });
  });

  describe('withdrawRedeemAllowed', () => {
    it('should always return true for Yo (no cooldown)', () => {
      const mockState = {
        totalAssets: 1000000000000000000000n,
        totalShares: 1000000000000000000000n,
      };

      expect(yoETH.eventPool.withdrawRedeemAllowed(mockState)).toBe(true);
    });
  });
});
