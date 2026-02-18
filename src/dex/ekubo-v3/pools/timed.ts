import { bigintMax } from '../utils';

const SLOT_DURATION_SECS = 12n;

export type RateDeltaBoundary = readonly [
  time: bigint,
  delta0: bigint,
  delta1: bigint,
];

export namespace TimedPoolState {
  export interface TimeRateDelta {
    time: bigint;
    delta0: bigint;
    delta1: bigint;
  }

  export interface Object {
    token0Rate: bigint;
    token1Rate: bigint;
    lastTime: bigint;
    virtualDeltas: TimeRateDelta[];
  }

  export function fromQuoter(
    token0Rate: bigint,
    token1Rate: bigint,
    lastTime: bigint,
    virtualDeltas: TimeRateDelta[],
  ): Object {
    return {
      token0Rate,
      token1Rate,
      lastTime: lastTime,
      virtualDeltas,
    };
  }

  export function applyRateDeltaBoundaries(
    timedPoolState: Object,
    boundaries: readonly RateDeltaBoundary[],
  ): void {
    const { virtualDeltas: deltas, lastTime: lastExecutionTime } =
      timedPoolState;
    let { token0Rate, token1Rate } = timedPoolState;
    let startIndex = 0;

    for (const [time, boundaryDelta0, boundaryDelta1] of boundaries) {
      if (time > lastExecutionTime) {
        let idx = findTimeDeltaIndex(deltas, time, startIndex);

        if (idx < 0) {
          idx = ~idx;
          deltas.splice(idx, 0, { time, delta0: 0n, delta1: 0n });
        }

        const delta = deltas[idx];
        const next0 = delta.delta0 + boundaryDelta0;
        const next1 = delta.delta1 + boundaryDelta1;

        if (next0 === 0n && next1 === 0n) {
          deltas.splice(idx, 1);
          startIndex = idx;
        } else {
          delta.delta0 = next0;
          delta.delta1 = next1;
          startIndex = idx + 1;
        }
      } else {
        token0Rate += boundaryDelta0;
        token1Rate += boundaryDelta1;
      }
    }
    timedPoolState.token0Rate = token0Rate;
    timedPoolState.token1Rate = token1Rate;
  }

  export function pruneDeltasAtOrBefore(
    deltas: TimeRateDelta[],
    timestamp: bigint,
  ): void {
    while (deltas.length > 0 && deltas[0].time <= timestamp) {
      deltas.shift();
    }
  }

  function findTimeDeltaIndex(
    deltas: TimeRateDelta[],
    searchTime: bigint,
    startIndex = 0,
  ): number {
    let l = startIndex;
    let r = deltas.length - 1;

    while (l <= r) {
      const mid = Math.floor((l + r) / 2);
      const midTime = deltas[mid].time;

      if (midTime === searchTime) {
        return mid;
      } else if (midTime < searchTime) {
        l = mid + 1;
      } else {
        r = mid - 1;
      }
    }

    return ~l;
  }
}

export function estimatedCurrentTime(last: bigint): bigint {
  return bigintMax(
    BigInt(Math.floor(Date.now() / 1000)),
    last + SLOT_DURATION_SECS,
  );
}

export function realLastTime(now: bigint, last: bigint): bigint {
  return now - ((now - last) & 0xffffffffn);
}

export function approximateExtraDistinctTimeBitmapLookups(
  startTime: bigint,
  endTime: bigint,
): number {
  return Number((endTime >> 16n) - (startTime >> 16n));
}
