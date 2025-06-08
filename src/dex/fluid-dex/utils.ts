export function sqrt(value: bigint) {
  let x = value;
  let z = x + 1n / 2n;
  let y = x;
  while (z - y < 0n) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}
