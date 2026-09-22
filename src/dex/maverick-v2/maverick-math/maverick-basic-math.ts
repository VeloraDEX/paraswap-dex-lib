import { BI_MAX_UINT256, BI_POWS } from '../../../bigint-constants';
import { _require } from '../../../utils';

export class MaverickBasicMath {
  static MAX_POW_RELATIVE_ERROR = BI_POWS[4];

  static abs(x: bigint) {
    return x < 0n ? -x : x;
  }

  static min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
  }

  static max(a: bigint, b: bigint): bigint {
    return a >= b ? a : b;
  }

  static clip(x: bigint, y: bigint): bigint {
    return x < y ? 0n : x - y;
  }

  static mulDivFloor(x: bigint, y: bigint, k: bigint): bigint {
    return this.mulDiv(x, y, this.max(1n, k));
  }

  static mulmod(x: bigint, y: bigint, k: bigint): bigint {
    return (x * y) % k;
  }

  static mulFloor(x: bigint, y: bigint): bigint {
    return this.mulDiv(x, y, BI_POWS[18]);
  }

  static mulDivCeil(x: bigint, y: bigint, k: bigint): bigint {
    let result = this.mulDivFloor(x, y, k);
    if (this.mulmod(x, y, this.max(1n, k)) != 0n) result = result + 1n;
    return result;
  }

  static sqrt(x: bigint) {
    let y = x;

    let z = 181n;

    if (y >= 0x10000000000000000000000000000000000) {
      y >>= 128n;
      z <<= 64n;
    }

    if (y >= 0x1000000000000000000) {
      y >>= 64n;
      z <<= 32n;
    }

    if (y >= 0x10000000000) {
      y >>= 32n;
      z <<= 16n;
    }

    if (y >= 0x1000000) {
      y >>= 16n;
      z <<= 8n;
    }

    z = (z * (y + 65536n)) >> 18n;
    z = (x / z + z) >> 1n;
    z = (x / z + z) >> 1n;
    z = (x / z + z) >> 1n;
    z = (x / z + z) >> 1n;
    z = (x / z + z) >> 1n;
    z = (x / z + z) >> 1n;
    z = (x / z + z) >> 1n;

    return x / z < z ? z - 1n : z;
  }

  static divDown(x: bigint, y: bigint): bigint {
    return this.mulDivDown(x, BI_POWS[18], y);
  }

  static divUp(x: bigint, y: bigint): bigint {
    return this.mulDivUp(x, BI_POWS[18], y);
  }

  static mulUp(x: bigint, y: bigint): bigint {
    return this.mulDivUp(x, y, BI_POWS[18]);
  }

  static mulDown(x: bigint, y: bigint): bigint {
    return this.mulDivDown(x, y, BI_POWS[18]);
  }

  static invFloor(x: bigint): bigint {
    return BI_POWS[36] / x;
  }

  static invCeil(denominator: bigint): bigint {
    return (BI_POWS[36] - 1n) / denominator + 1n;
  }

  static mulDivDown(x: bigint, y: bigint, denominator: bigint): bigint {
    return (x * y) / (denominator === 0n ? 1n : denominator);
  }

  static mulDiv(x: bigint, y: bigint, denominator: bigint): bigint {
    const result = (x * y) / denominator;

    _require(
      result <= BI_MAX_UINT256,
      '',
      { result, BI_MAX_UINT: BI_MAX_UINT256 },
      'result <= BI_MAX_UINT256',
    );

    return result;
  }

  static divCeil(x: bigint, y: bigint): bigint {
    return this.mulDivCeil(x, BI_POWS[18], y);
  }

  static mulCeil(x: bigint, y: bigint): bigint {
    return this.mulDivCeil(x, y, BI_POWS[18]);
  }

  static mulDivUp(x: bigint, y: bigint, denominator: bigint): bigint {
    let z = x * y;

    if (z === 0n) {
      return 0n;
    }

    return (z - 1n) / denominator + 1n;
  }

  static floorD8Unchecked(val: bigint): bigint {
    let val32 = val / BI_POWS[8];
    let check = val < 0 && val % BI_POWS[8] != 0n;
    return check ? val32 - 1n : val32;
  }
}
