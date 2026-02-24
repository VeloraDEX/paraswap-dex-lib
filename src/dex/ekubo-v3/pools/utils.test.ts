import {
  ConcentratedPoolTypeConfig,
  PoolConfig,
  PoolKey,
  StableswapPoolTypeConfig,
} from './utils';

describe(PoolKey, () => {
  describe(PoolKey.fromStringId, () => {
    test('concentrated', () => {
      const parsed = PoolKey.fromStringId(
        'ekubov3_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xdac17f958d2ee523a2206206994597c13d831ec7_0x553a2efc570c9e104942cec6ac1c18118e54c091_18446744073709_concentrated_100',
      );

      expect(parsed.token0).toBe(0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n);
      expect(parsed.token1).toBe(0xdac17f958d2ee523a2206206994597c13d831ec7n);
      expect(parsed.config.extension).toBe(
        0x553a2efc570c9e104942cec6ac1c18118e54c091n,
      );
      expect(parsed.config.fee).toBe(18446744073709n);
      expect(parsed.config.poolTypeConfig).toStrictEqual(
        new ConcentratedPoolTypeConfig(100),
      );
    });

    test('stableswap', () => {
      const parsed = PoolKey.fromStringId(
        'ekubov3_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xdac17f958d2ee523a2206206994597c13d831ec7_0x553a2efc570c9e104942cec6ac1c18118e54c091_18446744073709_stableswap_1_-100',
      );

      expect(parsed.token0).toBe(0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n);
      expect(parsed.token1).toBe(0xdac17f958d2ee523a2206206994597c13d831ec7n);
      expect(parsed.config.extension).toBe(
        0x553a2efc570c9e104942cec6ac1c18118e54c091n,
      );
      expect(parsed.config.fee).toBe(18446744073709n);
      expect(parsed.config.poolTypeConfig).toStrictEqual(
        new StableswapPoolTypeConfig(-100, 1),
      );
    });
  });

  describe('stringId', () => {
    test('concentrated', () => {
      expect(
        new PoolKey(
          0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
          0xdac17f958d2ee523a2206206994597c13d831ec7n,
          new PoolConfig(
            0x553a2efc570c9e104942cec6ac1c18118e54c091n,
            18446744073709n,
            new ConcentratedPoolTypeConfig(100),
          ),
        ).stringId,
      ).toBe(
        'ekubov3_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xdac17f958d2ee523a2206206994597c13d831ec7_0x553a2efc570c9e104942cec6ac1c18118e54c091_18446744073709_concentrated_100',
      );
    });

    test('stableswap', () => {
      expect(
        new PoolKey(
          0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
          0xdac17f958d2ee523a2206206994597c13d831ec7n,
          new PoolConfig(
            0x553a2efc570c9e104942cec6ac1c18118e54c091n,
            18446744073709n,
            new StableswapPoolTypeConfig(-100, 1),
          ),
        ).stringId,
      ).toBe(
        'ekubov3_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xdac17f958d2ee523a2206206994597c13d831ec7_0x553a2efc570c9e104942cec6ac1c18118e54c091_18446744073709_stableswap_1_-100',
      );
    });
  });

  describe('PoolConfig.fromCompressed', () => {
    test('stableswap rounds negative center tick to 16', () => {
      const config = new StableswapPoolTypeConfig(-17, 5);
      const decoded = PoolConfig.fromCompressed(config.compressed());
      expect(decoded.poolTypeConfig).toStrictEqual(
        new StableswapPoolTypeConfig(-16, 5),
      );
    });

    test('stableswap rounds positive center tick to 16', () => {
      const config = new StableswapPoolTypeConfig(17, 5);
      const decoded = PoolConfig.fromCompressed(config.compressed());
      expect(decoded.poolTypeConfig).toStrictEqual(
        new StableswapPoolTypeConfig(16, 5),
      );
    });
  });
});
