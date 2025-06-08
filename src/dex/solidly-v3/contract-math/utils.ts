import { NumberAsString } from '@paraswap/core';
import { TickBitMapMappings, TickInfo, TickInfoMappings } from '../types';
``;

export function _mulmod(x: bigint, y: bigint, m: bigint): bigint {
  return m === 0n ? 0n : (x * y) % m;
}

export function _lt(x: bigint, y: bigint) {
  return x < y ? 1n : 0n;
}

export function _gt(x: bigint, y: bigint) {
  return x > y ? 1n : 0n;
}

export function _reduceTickBitmap(
  tickBitmap: Record<NumberAsString, bigint>,
  tickBitmapToReduce: TickBitMapMappings[],
) {
  return tickBitmapToReduce.reduce<Record<NumberAsString, bigint>>(
    (acc, curr) => {
      const { index, value } = curr;
      acc[index] = value;
      return acc;
    },
    tickBitmap,
  );
}

export function _reduceTicks(
  ticks: Record<NumberAsString, TickInfo>,
  ticksToReduce: TickInfoMappings[],
) {
  return ticksToReduce.reduce<Record<string, TickInfo>>((acc, curr) => {
    const { index, value } = curr;
    if (value.initialized) {
      acc[index] = {
        liquidityGross: value.liquidityGross,
        liquidityNet: value.liquidityNet,
        initialized: value.initialized,
      };
    }
    return acc;
  }, ticks);
}
