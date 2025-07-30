import { WAD } from './Constants';

export function abs(x: bigint): bigint {
  return x > 0 ? x : -x;
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b) / c;
}

export function mulDivUp(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b + c - 1n) / c;
}

export function divUp(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function divWad(x: bigint, y: bigint): bigint {
  return (x * WAD) / y;
}

export function divWadUp(x: bigint, y: bigint): bigint {
  const product = x * WAD;
  const hasRemainder = product % y !== 0n;
  return product / y + (hasRemainder ? 1n : 0n);
}

export function mulWad(x: bigint, y: bigint): bigint {
  return (x * y) / WAD;
}

export function mulWadUp(x: bigint, y: bigint): bigint {
  const product = x * y;
  const hasRemainder = product % WAD !== 0n;
  return product / WAD + (hasRemainder ? 1n : 0n);
}

export function absDiff(
  x: bigint,
  y: bigint,
): { positive: boolean; diff: bigint } {
  const positive = x > y;
  const diff = positive ? x - y : y - x;
  return { positive, diff };
}

export function roundTick(
  currentTick: bigint,
  tickSpacing: bigint,
): { roundedTick: bigint; nextRoundedTick: bigint } {
  let compressed = currentTick / tickSpacing;
  if (currentTick < 0n && currentTick % tickSpacing !== 0n) compressed -= 1n;
  const roundedTick = compressed * tickSpacing;
  const nextRoundedTick = roundedTick + tickSpacing;
  return { roundedTick, nextRoundedTick };
}

export function roundTickSingle(
  currentTick: bigint,
  tickSpacing: bigint,
): bigint {
  let compressed = currentTick / tickSpacing;
  if (currentTick < 0n && currentTick % tickSpacing !== 0n) compressed -= 1n;
  return compressed * tickSpacing;
}

export function subReLU(x: bigint, y: bigint): bigint {
  return x > y ? x - y : 0n;
}

export function roundUpFullMulDivResult(
  x: bigint,
  y: bigint,
  d: bigint,
  resultRoundedDown: bigint,
): bigint {
  let result = resultRoundedDown;

  const mulMod = (x * y) % d;

  if (mulMod > 0n) {
    result = resultRoundedDown + 1n;
  }

  return result;
}

export function fullMulDiv(x: bigint, y: bigint, d: bigint) {
  return (x * y) / d;
}

export function fullMulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  let z = fullMulDiv(x, y, d);

  const product = x * y;
  if (product % d !== 0n) {
    z += 1n;
  }

  return z;
}

export function rpow(x: bigint, y: bigint, b: bigint): bigint {
  if (y === 0n) return b;
  if (x === 0n) return 0n;

  let z = (y & 1n) === 1n ? x : b;
  const half = b / 2n;

  for (y = y >> 1n; y > 0n; y = y >> 1n) {
    const xx = x * x;
    x = (xx + half) / b;

    if (y & 1n) {
      z = (z * x + half) / b;
    }
  }

  return z;
}

export function dist(x: bigint, y: bigint): bigint {
  return x > y ? x - y : y - x;
}

export function expWad(x: bigint): bigint {
  if (x <= -41446531673892822313n) {
    return 0n;
  }

  if (x >= 135305999368893231589n) {
    throw new Error('ExpOverflow');
  }

  x = (x << 78n) / 5n ** 18n;

  const ln2Times2Pow96 = 54916777467707473351141471128n;
  const k = ((x << 96n) / ln2Times2Pow96 + (1n << 95n)) >> 96n;

  x = x - k * ln2Times2Pow96;

  let y = x + 1346386616545796478920950773328n;
  y = ((y * x) >> 96n) + 57155421227552351082224309758442n;

  let p = y + x - 94201549194550492254356042504812n;
  p = ((p * y) >> 96n) + 28719021644029726153956944680412240n;
  p = p * x + (4385272521454847904659076985693276n << 96n);

  let q = x - 2855989394907223263936484059900n;
  q = ((q * x) >> 96n) + 50020603652535783019961831881945n;
  q = ((q * x) >> 96n) - 533845033583426703283633433725380n;
  q = ((q * x) >> 96n) + 3604857256930695427073651918091429n;
  q = ((q * x) >> 96n) - 14423608567350463180887372962807573n;
  q = ((q * x) >> 96n) + 26449188498355588339934803723976023n;

  let r = p / q;

  const scaleFactor = 3822833074963236453042738258902158003155416615667n;
  const shiftAmount = 195n - k;

  if (shiftAmount >= 0) {
    r = (r * scaleFactor) >> shiftAmount;
  } else {
    r = (r * scaleFactor) << -shiftAmount;
  }

  return r;
}

export function xWadToRoundedTick(
  xWad: bigint,
  mu: bigint,
  tickSpacing: bigint,
  roundUp: boolean,
): bigint {
  let x = xWad / WAD;
  const hasRemainder = xWad % WAD !== 0n;

  if (roundUp) {
    if (xWad > 0n && hasRemainder) x += 1n;
  } else {
    if (xWad < 0n && hasRemainder) x -= 1n;
  }

  return x * tickSpacing + mu;
}

export function weightedSum(
  value0: bigint,
  weight0: bigint,
  value1: bigint,
  weight1: bigint,
): bigint {
  return (value0 * weight0 + value1 * weight1) / (weight0 + weight1);
}
