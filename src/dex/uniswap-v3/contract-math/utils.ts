import { NumberAsString } from '@paraswap/core';
import {
  TickBitMapMappingsWithBigNumber,
  TickInfo,
  TickInfoMappingsWithBigNumber,
} from '../types';
import { bigIntify } from '../../../utils';

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
  tickBitmapToReduce: TickBitMapMappingsWithBigNumber[],
) {
  return tickBitmapToReduce.reduce<Record<NumberAsString, bigint>>(
    (acc, curr) => {
      const { index, value } = curr;
      acc[index] = bigIntify(value);
      return acc;
    },
    tickBitmap,
  );
}

export function _reduceTicks(
  ticks: Record<NumberAsString, TickInfo>,
  ticksToReduce: TickInfoMappingsWithBigNumber[],
) {
  return ticksToReduce.reduce<Record<string, TickInfo>>((acc, curr) => {
    const { index, value } = curr;
    if (value.initialized) {
      acc[index] = {
        liquidityGross: bigIntify(value.liquidityGross),
        liquidityNet: bigIntify(value.liquidityNet),
        tickCumulativeOutside: bigIntify(value.tickCumulativeOutside),
        secondsPerLiquidityOutsideX128: bigIntify(
          value.secondsPerLiquidityOutsideX128,
        ),
        secondsOutside: bigIntify(value.secondsOutside),
        initialized: value.initialized,
      };
    }
    return acc;
  }, ticks);
}
