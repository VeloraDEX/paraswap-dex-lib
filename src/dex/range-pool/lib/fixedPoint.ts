/**
 * Bit-exact fixed-point (WAD) math for Range Pool pricing.
 *
 * Vendored from `@balancer-labs/balancer-maths` (v0.0.36) `MathSol` + `LogExpMath`,
 * which are themselves an exact port of Balancer's Solidity `FixedPoint` / `LogExpMath`.
 *
 * WHY VENDORED instead of importing balancer-maths' exported `_computeOutGivenExactIn` /
 * `_computeInGivenExactOut`: those throw `MaxInRatio`/`MaxOutRatio` above a 30% trade ratio.
 * Range Pools' `RangeMath` deliberately has NO such guard — output is bounded by the pool's
 * fact balance instead (see `rangeMath.ts`). `MathSol`/`LogExpMath` are not exported from the
 * package, so the primitives are vendored verbatim here. `pow{Up,Down}` reproduce the monorepo
 * `FixedPoint`'s y==1/2/4 shortcuts exactly (verified against
 * `balancer-v3-monorepo/pkg/solidity-utils/contracts/math/FixedPoint.sol`).
 *
 * Parity is guarded two ways (see rangeMath.test.ts): (1) a cheap unit cross-check against
 * balancer-maths' own `_computeOutGivenExactIn` for sub-30% amounts, and (2) on-chain parity
 * vs `Router.querySwap...` on a mainnet fork.
 */

export const WAD = 1_000_000_000_000_000_000n; // 1e18
const TWO_WAD = 2_000_000_000_000_000_000n;
const FOUR_WAD = 4_000_000_000_000_000_000n;
const RAY = 10n ** 36n;
const HUNDRED_WAD = 100n * WAD;
const MAX_POW_RELATIVE_ERROR = 10_000n;

// --- MathSol primitives -------------------------------------------------------

export function mulDown(a: bigint, b: bigint): bigint {
  return (a * b) / WAD;
}

export function mulUp(a: bigint, b: bigint): bigint {
  const product = a * b;
  if (product === 0n) return 0n;
  return (product - 1n) / WAD + 1n;
}

export function divDown(a: bigint, b: bigint): bigint {
  if (a === 0n) return 0n;
  return (a * WAD) / b;
}

export function divUp(a: bigint, b: bigint): bigint {
  if (a === 0n) return 0n;
  return (a * WAD - 1n) / b + 1n;
}

/** Returns max(0, 1 - x) in WAD. */
export function complement(x: bigint): bigint {
  return x < WAD ? WAD - x : 0n;
}

/**
 * x^y rounding up, matching Solidity FixedPoint.powUp (with the y==1/2/4 shortcuts).
 */
export function powUp(x: bigint, y: bigint): bigint {
  if (y === WAD) return x;
  if (y === TWO_WAD) return mulUp(x, x);
  if (y === FOUR_WAD) {
    const square = mulUp(x, x);
    return mulUp(square, square);
  }
  const raw = pow(x, y);
  const maxError = mulUp(raw, MAX_POW_RELATIVE_ERROR) + 1n;
  return raw + maxError;
}

/**
 * x^y rounding down, matching Solidity FixedPoint.powDown (with the y==1/2/4 shortcuts).
 */
export function powDown(x: bigint, y: bigint): bigint {
  if (y === WAD) return x;
  if (y === TWO_WAD) return mulUp(x, x);
  if (y === FOUR_WAD) {
    const square = mulUp(x, x);
    return mulUp(square, square);
  }
  const raw = pow(x, y);
  const maxError = mulUp(raw, MAX_POW_RELATIVE_ERROR) + 1n;
  return raw < maxError ? 0n : raw - maxError;
}

// --- LogExpMath (verbatim port) ----------------------------------------------

const MAX_NATURAL_EXPONENT = 130n * WAD;
const MIN_NATURAL_EXPONENT = -41n * WAD;
const LN_36_LOWER_BOUND = WAD - 10n ** 17n;
const LN_36_UPPER_BOUND = WAD + 10n ** 17n;
const MILD_EXPONENT_BOUND =
  289480223093290488558927462521719769633174961664101410098n;
const X_OUT_OF_BOUNDS =
  57896044618658097711785492504343953926634992332820282019728792003956564819968n;

const x0 = 128000000000000000000n;
const a0 = 38877084059945950922200000000000000000000000000000000000n;
const x1 = 64000000000000000000n;
const a1 = 6235149080811616882910000000n;
const x2 = 3200000000000000000000n;
const a2 = 7896296018268069516100000000000000n;
const x3 = 1600000000000000000000n;
const a3 = 888611052050787263676000000n;
const x4 = 800000000000000000000n;
const a4 = 298095798704172827474000n;
const x5 = 400000000000000000000n;
const a5 = 5459815003314423907810n;
const x6 = 200000000000000000000n;
const a6 = 738905609893065022723n;
const x7 = 100000000000000000000n;
const a7 = 271828182845904523536n;
const x8 = 50000000000000000000n;
const a8 = 164872127070012814685n;
const x9 = 25000000000000000000n;
const a9 = 128402541668774148407n;
const x10 = 12500000000000000000n;
const a10 = 113314845306682631683n;
const x11 = 6250000000000000000n;
const a11 = 106449445891785942956n;

/** e^x for signed 18-decimal fixed point x. */
export function exp(x_: bigint): bigint {
  let x = x_;
  if (!(x >= MIN_NATURAL_EXPONENT && x <= MAX_NATURAL_EXPONENT)) {
    throw new Error('LogExpMath: INVALID_EXPONENT');
  }
  if (x < 0n) {
    return (WAD * WAD) / exp(-1n * x);
  }

  let firstAN: bigint;
  if (x >= x0) {
    x -= x0;
    firstAN = a0;
  } else if (x >= x1) {
    x -= x1;
    firstAN = a1;
  } else {
    firstAN = 1n;
  }

  x *= 100n;

  let product = HUNDRED_WAD;
  if (x >= x2) {
    x -= x2;
    product = (product * a2) / HUNDRED_WAD;
  }
  if (x >= x3) {
    x -= x3;
    product = (product * a3) / HUNDRED_WAD;
  }
  if (x >= x4) {
    x -= x4;
    product = (product * a4) / HUNDRED_WAD;
  }
  if (x >= x5) {
    x -= x5;
    product = (product * a5) / HUNDRED_WAD;
  }
  if (x >= x6) {
    x -= x6;
    product = (product * a6) / HUNDRED_WAD;
  }
  if (x >= x7) {
    x -= x7;
    product = (product * a7) / HUNDRED_WAD;
  }
  if (x >= x8) {
    x -= x8;
    product = (product * a8) / HUNDRED_WAD;
  }
  if (x >= x9) {
    x -= x9;
    product = (product * a9) / HUNDRED_WAD;
  }

  let seriesSum = HUNDRED_WAD;
  let term = x;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 2n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 3n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 4n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 5n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 6n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 7n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 8n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 9n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 10n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 11n;
  seriesSum += term;
  term = (term * x) / HUNDRED_WAD / 12n;
  seriesSum += term;

  return (((product * seriesSum) / HUNDRED_WAD) * firstAN) / 100n;
}

function _ln36(x_: bigint): bigint {
  let x = x_;
  x *= WAD;
  const z = ((x - RAY) * RAY) / (x + RAY);
  const zSquared = (z * z) / RAY;
  let num = z;
  let seriesSum = num;
  num = (num * zSquared) / RAY;
  seriesSum += num / 3n;
  num = (num * zSquared) / RAY;
  seriesSum += num / 5n;
  num = (num * zSquared) / RAY;
  seriesSum += num / 7n;
  num = (num * zSquared) / RAY;
  seriesSum += num / 9n;
  num = (num * zSquared) / RAY;
  seriesSum += num / 11n;
  num = (num * zSquared) / RAY;
  seriesSum += num / 13n;
  num = (num * zSquared) / RAY;
  seriesSum += num / 15n;
  return seriesSum * 2n;
}

function _ln(a_: bigint): bigint {
  let a = a_;
  if (a < WAD) {
    return -1n * _ln((WAD * WAD) / a);
  }
  let sum = 0n;
  if (a >= a0 * WAD) {
    a /= a0;
    sum += x0;
  }
  if (a >= a1 * WAD) {
    a /= a1;
    sum += x1;
  }
  sum *= 100n;
  a *= 100n;
  if (a >= a2) {
    a = (a * HUNDRED_WAD) / a2;
    sum += x2;
  }
  if (a >= a3) {
    a = (a * HUNDRED_WAD) / a3;
    sum += x3;
  }
  if (a >= a4) {
    a = (a * HUNDRED_WAD) / a4;
    sum += x4;
  }
  if (a >= a5) {
    a = (a * HUNDRED_WAD) / a5;
    sum += x5;
  }
  if (a >= a6) {
    a = (a * HUNDRED_WAD) / a6;
    sum += x6;
  }
  if (a >= a7) {
    a = (a * HUNDRED_WAD) / a7;
    sum += x7;
  }
  if (a >= a8) {
    a = (a * HUNDRED_WAD) / a8;
    sum += x8;
  }
  if (a >= a9) {
    a = (a * HUNDRED_WAD) / a9;
    sum += x9;
  }
  if (a >= a10) {
    a = (a * HUNDRED_WAD) / a10;
    sum += x10;
  }
  if (a >= a11) {
    a = (a * HUNDRED_WAD) / a11;
    sum += x11;
  }
  const z = ((a - HUNDRED_WAD) * HUNDRED_WAD) / (a + HUNDRED_WAD);
  const zSquared = (z * z) / HUNDRED_WAD;
  let num = z;
  let seriesSum = num;
  num = (num * zSquared) / HUNDRED_WAD;
  seriesSum += num / 3n;
  num = (num * zSquared) / HUNDRED_WAD;
  seriesSum += num / 5n;
  num = (num * zSquared) / HUNDRED_WAD;
  seriesSum += num / 7n;
  num = (num * zSquared) / HUNDRED_WAD;
  seriesSum += num / 9n;
  num = (num * zSquared) / HUNDRED_WAD;
  seriesSum += num / 11n;
  seriesSum *= 2n;
  return (sum + seriesSum) / 100n;
}

/** x^y for unsigned 18-decimal fixed point x, y. */
export function pow(x: bigint, y: bigint): bigint {
  if (y === 0n) return WAD;
  if (x === 0n) return 0n;

  if (x >= X_OUT_OF_BOUNDS) throw new Error('LogExpMath: X_OUT_OF_BOUNDS');
  if (y >= MILD_EXPONENT_BOUND) throw new Error('LogExpMath: Y_OUT_OF_BOUNDS');

  let logxTimesY: bigint;
  if (LN_36_LOWER_BOUND < x && x < LN_36_UPPER_BOUND) {
    const ln36X = _ln36(x);
    logxTimesY = (ln36X / WAD) * y + ((ln36X % WAD) * y) / WAD;
  } else {
    logxTimesY = _ln(x) * y;
  }
  logxTimesY /= WAD;

  if (
    !(MIN_NATURAL_EXPONENT <= logxTimesY && logxTimesY <= MAX_NATURAL_EXPONENT)
  ) {
    throw new Error('LogExpMath: PRODUCT_OUT_OF_BOUNDS');
  }
  return exp(logxTimesY);
}
