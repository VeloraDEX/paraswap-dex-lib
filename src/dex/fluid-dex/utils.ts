export function sqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('sqrt of negative');
  if (value < 2n) return value;
  let z = value;
  let x = (value + 1n) / 2n;
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  return z;
}
