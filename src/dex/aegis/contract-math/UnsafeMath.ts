export class UnsafeMath {
  static divRoundingUp(x: bigint, y: bigint): bigint {
    if (y === 0n) return 0n;
    return (x + y - 1n) / y;
  }

  static simpleMulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
    if (denominator === 0n) return 0n;
    return (a * b) / denominator;
  }
}
