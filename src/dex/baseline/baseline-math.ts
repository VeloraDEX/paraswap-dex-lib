// Fixed-point math on 1e18-scaled integers (WAD), matching the on-chain curve.
// A thrown error means the curve reverts the quote; callers price it as 0.

import { getBigIntPow } from '../../utils';

export const WAD = 10n ** 18n;

const MAX_POW_ARG = 135n * WAD;

// Division rounded toward negative infinity (b must be > 0 here).
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

// Division rounded toward positive infinity.
function ceilDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b > 0n ? q + 1n : q;
}

export function mulWad(x: bigint, y: bigint): bigint {
  return floorDiv(x * y, WAD);
}

export function mulWadUp(x: bigint, y: bigint): bigint {
  return ceilDiv(x * y, WAD);
}

export function divWad(x: bigint, y: bigint): bigint {
  return floorDiv(x * WAD, y);
}

export function divWadUp(x: bigint, y: bigint): bigint {
  return ceilDiv(x * WAD, y);
}

export function fullMulDiv(x: bigint, y: bigint, d: bigint): bigint {
  return floorDiv(x * y, d);
}

export function fullMulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  return ceilDiv(x * y, d);
}

export function zeroFloorSub(x: bigint, y: bigint): bigint {
  return x <= y ? 0n : x - y;
}

// Rescale an amount from its token decimals to 1e18 precision.
export function normalizeWad(amount: bigint, decimals: number): bigint {
  if (decimals < 18) return amount * getBigIntPow(18 - decimals);
  if (decimals > 18) return amount / getBigIntPow(decimals - 18);
  return amount;
}

// Rescale a 1e18-precision amount back to token decimals, rounding down.
export function denormalizeWad(amount: bigint, decimals: number): bigint {
  if (decimals < 18) return amount / getBigIntPow(18 - decimals);
  if (decimals > 18) return amount * getBigIntPow(decimals - 18);
  return amount;
}

// Same as denormalizeWad but rounding up.
export function denormalizeWadUp(amount: bigint, decimals: number): bigint {
  if (decimals < 18) return ceilDiv(amount, getBigIntPow(18 - decimals));
  if (decimals > 18) return amount * getBigIntPow(decimals - 18);
  return amount;
}

// Normalize a signed amount, preserving its sign.
export function toWadSigned(amount: bigint, decimals: number): bigint {
  return amount >= 0n
    ? normalizeWad(amount, decimals)
    : -normalizeWad(-amount, decimals);
}

function bitLength(x: bigint): number {
  return x.toString(2).length;
}

// Natural logarithm of a 1e18-scaled number, returned in 1e18 precision.
export function lnWad(x: bigint): bigint {
  if (x <= 0n) throw new Error('lnWad: non-positive input');
  if (bitLength(x) > 256) throw new Error('lnWad: input too large');

  const r = 256 - bitLength(x);
  const x96 = (x << BigInt(r)) >> 159n;

  let p =
    43456485725739037958740375743393n +
    (((24828157081833163892658089445524n +
      (((3273285459638523848632254066296n + x96) * x96) >> 96n)) *
      x96) >>
      96n);
  p = ((p * x96) >> 96n) - 11111509109440967052023855526967n;
  p = ((p * x96) >> 96n) - 45023709667254063763336534515857n;
  p = ((p * x96) >> 96n) - 14706773417378608786704636184526n;
  p = p * x96 - (795164235651350426258249787498n << 96n);

  let q = 5573035233440673466300451813936n + x96;
  q = 71694874799317883764090561454958n + ((x96 * q) >> 96n);
  q = 283447036172924575727196451306956n + ((x96 * q) >> 96n);
  q = 401686690394027663651624208769553n + ((x96 * q) >> 96n);
  q = 204048457590392012362485061816622n + ((x96 * q) >> 96n);
  q = 31853899698501571402653359427138n + ((x96 * q) >> 96n);
  q = 909429971244387300277376558375n + ((x96 * q) >> 96n);

  p = p / q;
  p = 1677202110996718588342820967067443963516166n * p;
  p =
    16597577552685614221487285958193947469193820559219878177908093499208371n *
      BigInt(159 - r) +
    p;
  p =
    600920179829731861736702779321621459595472258049074101567377883020018308n +
    p;
  return p >> 174n;
}

// e raised to a 1e18-scaled exponent, returned in 1e18 precision.
export function expWad(x: bigint): bigint {
  if (x <= -41446531673892822313n) return 0n;
  if (x >= 135305999368893231589n) throw new Error('expWad: input too large');

  let x2 = (x << 78n) / 3814697265625n;
  const k = ((x2 << 96n) / 54916777467707473351141471128n + (1n << 95n)) >> 96n;
  x2 = x2 - k * 54916777467707473351141471128n;

  let y = x2 + 1346386616545796478920950773328n;
  y = ((y * x2) >> 96n) + 57155421227552351082224309758442n;
  let p = y + x2 - 94201549194550492254356042504812n;
  p = ((p * y) >> 96n) + 28719021644029726153956944680412240n;
  p = p * x2 + (4385272521454847904659076985693276n << 96n);

  let q = x2 - 2855989394907223263936484059900n;
  q = ((q * x2) >> 96n) + 50020603652535783019961831881945n;
  q = ((q * x2) >> 96n) - 533845033583426703283633433725380n;
  q = ((q * x2) >> 96n) + 3604857256930695427073651918091429n;
  q = ((q * x2) >> 96n) - 14423608567350463180887372962807573n;
  q = ((q * x2) >> 96n) + 26449188498355588339934803723976023n;

  let res = p / q;
  res = res * 3822833074963236453042738258902158003155416615667n;
  const shift = 195n - k;
  if (shift < 0n) throw new Error('expWad: shift underflow');
  return res >> shift;
}

// x raised to the power y, both 1e18-scaled: exp(ln(x) * y).
export function powWad(x: bigint, y: bigint): bigint {
  if (x <= 0n) throw new Error('powWad: non-positive base');
  const exponent = (lnWad(x) * y) / WAD;
  const res = expWad(exponent);
  if (res === 0n) throw new Error('powWad: result underflow');
  return res;
}

// Throws if raising a ratio to the convexity exponent would overflow the curve.
export function checkPowLimit(ratio: bigint, convexityExp: bigint): void {
  if (ratio === WAD) return;
  if (mulWad(convexityExp, lnWad(ratio)) > MAX_POW_ARG) {
    throw new Error('checkPowLimit: exponent too large');
  }
}

// Integer square root, floored.
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// Square root of a 1e18-scaled number, returned in 1e18 precision.
export function sqrtWad(x: bigint): bigint {
  return isqrt(x * WAD);
}
