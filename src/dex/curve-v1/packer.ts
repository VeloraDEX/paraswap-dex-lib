export const encodeCurveAssets = (i: number, j: number): bigint => {
  // Ensure i and j are within the range of uint128
  if (i < 0 || j < 0 || i >= 2 ** 128 || j >= 2 ** 128) {
    throw new Error('i and j must be within the range of uint128');
  }

  // Convert i and j to bigint
  const bigI = BigInt(i);
  const bigJ = BigInt(j);

  // Left shift i by 128 bits and then bitwise OR with j
  const packedValue = (bigI << 128n) | bigJ;

  return packedValue;
};
