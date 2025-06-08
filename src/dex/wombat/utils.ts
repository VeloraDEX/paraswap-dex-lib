import { BI_POWS } from '../../bigint-constants';
import { MultiResult } from '../../lib/multi-wrapper';
import { BytesLike } from 'ethers';
import { generalDecoder } from '../../lib/decoders';

export const WAD = BI_POWS[18];

export function wmul(x: bigint, y: bigint): bigint {
  return (x * y + WAD / 2n) / WAD;
}

export function wdiv(x: bigint, y: bigint): bigint {
  return (x * WAD + y / 2n) / y;
}

// Convert x to WAD (18 decimals) from d decimals.
export function toWad(x: bigint, d: bigint): bigint {
  if (d < 18n) {
    return x * 10n ** (18n - d);
  } else if (d > 18n) {
    return x / 10n ** (d - 18n);
  }
  return x;
}
// Convert x from WAD (18 decimals) to d decimals.
export function fromWad(x: bigint, d: bigint): bigint {
  if (d < 18n) {
    return x / 10n ** (18n - d);
  } else if (d > 18n) {
    return x * 10n ** (d - 18n);
  }
  return x;
}

// Babylonian Method with initial guess (typecast as int)
export function sqrt(y: bigint, guess: bigint): bigint {
  let z = 0n;
  if (y > 3) {
    if (guess > 0 && guess <= y) {
      z = guess;
    } else if (guess < 0 && -guess <= y) {
      z = -guess;
    } else {
      z = y;
    }
    let x = (y / z + z) / 2n;
    while (x != z) {
      z = x;
      x = (y / x + x) / 2n;
    }
  } else if (y != 0n) {
    z = 1n;
  }

  return z;
}

export const uint120ToBigInt = (
  result: MultiResult<BytesLike> | BytesLike,
): bigint => {
  return generalDecoder(result, ['uint120'], 0n, value => value[0].toBigInt());
};

export function convertUint256ToInt256(uint256Value: bigint): bigint {
  const isNegative =
    (uint256Value &
      BigInt(
        '0x8000000000000000000000000000000000000000000000000000000000000000',
      )) !==
    BigInt(0);

  if (isNegative) {
    return (
      uint256Value -
      BigInt(
        '0x10000000000000000000000000000000000000000000000000000000000000000',
      )
    );
  } else {
    return uint256Value;
  }
}
