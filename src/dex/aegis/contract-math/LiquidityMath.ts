import { _require } from '../../../utils';

export class LiquidityMath {
  static addDelta(x: bigint, y: bigint): bigint {
    const maxUint128 = (1n << 128n) - 1n;

    _require(
      x >= 0n && x < maxUint128,
      'x is out of uint128 range',
      { x },
      'x >= 0n && x < maxUint128',
    );

    _require(
      y >= -(1n << 127n) && y < 1n << 127n,
      'y is out of int128 range',
      { y },
      'y >= -(1n << 127n) && y < 1n << 127n',
    );

    const z = x + y;

    _require(
      z >= 0n && z <= maxUint128,
      'SafeCastOverflow',
      { z, maxUint128 },
      'z >= 0n && z <= maxUint128',
    );

    return z;
  }
}
