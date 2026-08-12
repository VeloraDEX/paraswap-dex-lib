import { PoolState } from '../types';
import { _require } from '../../../utils';
import { BitMath } from '../../uniswap-v3/contract-math/BitMath';

export class TickBitMap {
  static readonly MAX_UINT256: bigint = BigInt(
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  );

  static readonly MAX_UINT8: bigint = 255n;

  static compress(tick: bigint, tickSpacing: bigint): bigint {
    const compressed = tick / tickSpacing;
    if (tick < 0 && tick % tickSpacing !== 0n) {
      return compressed - 1n;
    }
    return compressed;
  }

  static position(tick: bigint): [bigint, bigint] {
    return [BigInt.asIntN(16, tick >> 8n), BigInt.asUintN(8, tick % 256n)];
  }

  static flipTick(
    poolState: PoolState,
    tick: bigint,
    tickSpacing: bigint,
  ): void {
    _require(
      tick % tickSpacing === 0n,
      '',
      { tick, tickSpacing },
      'tick % tickSpacing === 0n',
    );

    const compressed = TickBitMap.compress(tick, tickSpacing);
    const [wordPos, bitPos] = TickBitMap.position(compressed);

    const mask = 1n << bitPos;

    if (!poolState.tickBitmap) {
      poolState.tickBitmap = {};
    }

    const currentValue = poolState.tickBitmap[wordPos.toString()] || 0n;

    poolState.tickBitmap[wordPos.toString()] = currentValue ^ mask;
  }

  static nextInitializedTickWithinOneWord(
    poolState: PoolState,
    tick: bigint,
    tickSpacing: bigint,
    lte: boolean,
  ): [bigint, boolean] {
    const compressed = TickBitMap.compress(tick, tickSpacing);

    let initialized: boolean;
    let next: bigint;

    if (lte) {
      const [wordPos, bitPos] = TickBitMap.position(compressed);
      const mask = TickBitMap.MAX_UINT256 >> (TickBitMap.MAX_UINT8 - bitPos);

      const value = poolState.tickBitmap[wordPos.toString()] || 0n;
      const masked = value & mask;

      initialized = masked !== 0n;
      next = initialized
        ? (compressed -
            BigInt.asIntN(24, bitPos - BitMath.mostSignificantBit(masked))) *
          tickSpacing
        : (compressed - BigInt.asIntN(24, bitPos)) * tickSpacing;
    } else {
      const [wordPos, bitPos] = TickBitMap.position(compressed + 1n);
      const mask = ~((1n << bitPos) - 1n);
      const value = poolState.tickBitmap[wordPos.toString()] || 0n;
      const masked = value & mask;
      initialized = masked !== 0n;

      next = initialized
        ? (compressed +
            1n +
            BigInt.asIntN(24, BitMath.leastSignificantBit(masked) - bitPos)) *
          tickSpacing
        : (compressed + 1n + BigInt.asIntN(24, TickBitMap.MAX_UINT8 - bitPos)) *
          tickSpacing;
    }

    return [next, initialized];
  }
}
