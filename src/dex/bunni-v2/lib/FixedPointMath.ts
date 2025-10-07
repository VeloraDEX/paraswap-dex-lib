import { WAD } from './Constants';

export abstract class FixedPointMath {
  static sDivWad(x: bigint, y: bigint): bigint {
    const z = x * WAD;
    if (y === 0n || z / WAD !== x) {
      throw new Error('SDivWadFailed');
    }
    return z / y;
  }
}
