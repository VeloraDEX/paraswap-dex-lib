import { _require } from '../../../utils';

export class FullMath {
  static mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
    _require(
      denominator !== 0n,
      'Denominator cannot be zero',
      { denominator },
      'denominator !== 0n',
    );

    const product = a * b;
    return product / denominator;
  }

  static mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
    _require(
      denominator !== 0n,
      'Denominator cannot be zero',
      { denominator },
      'denominator !== 0n',
    );

    const product = a * b;
    const result = product / denominator;
    const remainder = product % denominator;

    return remainder === 0n ? result : result + 1n;
  }
}
