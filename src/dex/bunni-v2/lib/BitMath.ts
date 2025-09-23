import { BI_MAX_UINT256 } from '../../../bigint-constants';

const POWERS_OF_2 = [128n, 64n, 32n, 16n, 8n, 4n, 2n, 1n].map(
  (pow: bigint): [bigint, bigint] => [pow, 2n ** pow],
);

export abstract class BitMath {
  private constructor() {}

  static mostSignificantBit(x: bigint): bigint {
    if (x <= 0n) throw new Error('ZERO');
    if (x > BI_MAX_UINT256) throw new Error('MAX');

    let msb: bigint = 0n;
    for (const [power, min] of POWERS_OF_2) {
      if (x >= min) {
        x = x >> power;
        msb += power;
      }
    }
    return msb;
  }
}
