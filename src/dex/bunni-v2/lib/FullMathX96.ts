import { Q96 } from './Constants';

export abstract class FullMathX96 {
  static fullMulX96(x: bigint, y: bigint): bigint {
    return (x * y) / Q96;
  }

  static fullMulX96Up(x: bigint, y: bigint): bigint {
    let z = this.fullMulX96(x, y);

    if ((x * y) % Q96 !== 0n) {
      z += 1n;
      if (z === 0n) {
        throw new Error('FullMulDivFailed()');
      }
    }

    return z;
  }
}
