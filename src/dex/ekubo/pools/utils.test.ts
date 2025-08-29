import { PoolConfig, PoolKey } from './utils';

describe(PoolKey, () => {
  describe(PoolKey.fromStringId, () => {
    test('example', () => {
      const parsed = PoolKey.fromStringId(
        'ekubo_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xdac17f958d2ee523a2206206994597c13d831ec7_0x553a2efc570c9e104942cec6ac1c18118e54c091_18446744073709_50',
      );

      expect(parsed.token0).toBe(0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n);
      expect(parsed.token1).toBe(0xdac17f958d2ee523a2206206994597c13d831ec7n);
      expect(parsed.config.extension).toBe(
        0x553a2efc570c9e104942cec6ac1c18118e54c091n,
      );
      expect(parsed.config.fee).toBe(18446744073709n);
      expect(parsed.config.tickSpacing).toBe(50);
    });
  });

  describe('stringId', () => {
    test('example', () => {
      expect(
        new PoolKey(
          0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
          0xdac17f958d2ee523a2206206994597c13d831ec7n,
          new PoolConfig(
            0x553a2efc570c9e104942cec6ac1c18118e54c091n,
            18446744073709n,
            50,
          ),
        ).stringId,
      ).toBe(
        'ekubo_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xdac17f958d2ee523a2206206994597c13d831ec7_0x553a2efc570c9e104942cec6ac1c18118e54c091_18446744073709_50',
      );
    });
  });
});
