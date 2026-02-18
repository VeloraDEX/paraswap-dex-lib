import { _require } from '../../../utils';

export class BitMath {
  static mostSignificantBit(x: bigint): bigint {
    _require(x > 0, '', { x }, 'x > 0');

    let r = 0n;
    if (x > 0xffffffffffffffffffffffffffffffffn) {
      x >>= 128n;
      r += 128n;
    }
    if (x > 0xffffffffffffffffn) {
      x >>= 64n;
      r += 64n;
    }
    if (x > 0xffffffffn) {
      x >>= 32n;
      r += 32n;
    }
    if (x > 0xffffn) {
      x >>= 16n;
      r += 16n;
    }
    if (x > 0xffn) {
      x >>= 8n;
      r += 8n;
    }
    if (x > 0xfn) {
      x >>= 4n;
      r += 4n;
    }
    if (x > 0x3n) {
      x >>= 2n;
      r += 2n;
    }
    if (x > 0x1n) {
      r += 1n;
    }

    return r;
  }

  static leastSignificantBit(x: bigint): bigint {
    _require(x > 0, '', { x }, 'x > 0');

    let r = 0n;
    while ((x & 1n) === 0n) {
      x >>= 1n;
      r++;
    }

    return r;
  }
}
