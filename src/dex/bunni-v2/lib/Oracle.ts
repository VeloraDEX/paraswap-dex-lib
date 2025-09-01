import { Observation } from '../types';

export const MAX_ABS_TICK_MOVE: bigint = 9116n;

export function transform(
  last: Observation,
  blockTimestamp: bigint,
  tick: bigint,
): Observation {
  const delta = blockTimestamp - last.blockTimestamp;

  if (tick - last.prevTick > MAX_ABS_TICK_MOVE) {
    tick = last.prevTick + MAX_ABS_TICK_MOVE;
  } else if (tick - last.prevTick < -MAX_ABS_TICK_MOVE) {
    tick = last.prevTick - MAX_ABS_TICK_MOVE;
  }

  return {
    blockTimestamp: blockTimestamp,
    prevTick: tick,
    tickCumulative: last.tickCumulative + tick * delta,
    initialized: true,
  };
}

export function write(
  observations: Observation[],
  intermediate: Observation,
  index: bigint,
  blockTimestamp: bigint,
  tick: bigint,
  cardinality: bigint,
  cardinalityNext: bigint,
  minInterval: bigint,
): {
  intermediateUpdated: Observation;
  indexUpdated: bigint;
  cardinalityUpdated: bigint;
} {
  if (intermediate.blockTimestamp === blockTimestamp) {
    return {
      intermediateUpdated: intermediate,
      indexUpdated: index,
      cardinalityUpdated: cardinality,
    };
  }

  const intermediateUpdated = transform(intermediate, blockTimestamp, tick);

  if (
    blockTimestamp - observations[Number(index)].blockTimestamp <
    minInterval
  ) {
    return {
      intermediateUpdated,
      indexUpdated: index,
      cardinalityUpdated: cardinality,
    };
  }

  let cardinalityUpdated: bigint;
  if (cardinalityNext > cardinality && index === cardinality - 1n) {
    cardinalityUpdated = cardinalityNext;
  } else {
    cardinalityUpdated = cardinality;
  }

  const indexUpdated = (index + 1n) % cardinalityUpdated;
  observations[Number(indexUpdated)] = intermediateUpdated;
  return { intermediateUpdated, indexUpdated, cardinalityUpdated };
}

export function grow(
  observations: Observation[],
  current: bigint,
  next: bigint,
): bigint {
  if (next <= current) return current;

  for (let i = Number(current); i < Number(next); i++) {
    observations[i] = {
      blockTimestamp: 1n,
      prevTick: 0n,
      tickCumulative: 0n,
      initialized: false,
    };
  }

  return next;
}

export function binarySearch(
  observations: Observation[],
  time: bigint,
  target: bigint,
  index: bigint,
  cardinality: bigint,
): { beforeOrAt: Observation; atOrAfter: Observation } {
  let beforeOrAt = _emptyObservation();
  let atOrAfter = _emptyObservation();

  let l = (index + 1n) % cardinality;
  let r = l + cardinality - 1n;
  let i: bigint = 0n;

  while (l <= r) {
    i = (l + r) / 2n;
    beforeOrAt = observations[Number(i % cardinality)] || _emptyObservation();

    if (!beforeOrAt.initialized) {
      l = i + 1n;
      continue;
    }

    atOrAfter =
      observations[Number((i + 1n) % cardinality)] || _emptyObservation();

    const targetAtOrAfter = lte(time, beforeOrAt.blockTimestamp, target);
    if (targetAtOrAfter && lte(time, target, atOrAfter.blockTimestamp)) break;

    if (!targetAtOrAfter) r = i - 1n;
    else l = i + 1n;
  }

  return { beforeOrAt, atOrAfter };
}

export function getSurroundingObservations(
  observations: Observation[],
  intermediate: Observation,
  time: bigint,
  target: bigint,
  tick: bigint,
  index: bigint,
  cardinality: bigint,
): { beforeOrAt: Observation; atOrAfter: Observation } {
  let beforeOrAt: Observation = intermediate;
  let atOrAfter: Observation = {
    blockTimestamp: 0n,
    prevTick: 0n,
    tickCumulative: 0n,
    initialized: false,
  };

  if (lte(time, beforeOrAt.blockTimestamp, target)) {
    if (beforeOrAt.blockTimestamp === target) {
      return { beforeOrAt, atOrAfter };
    } else {
      return { beforeOrAt, atOrAfter: transform(beforeOrAt, target, tick) };
    }
  }

  beforeOrAt = observations[Number(index)] ?? _emptyObservation();
  atOrAfter = intermediate;

  if (lte(time, beforeOrAt.blockTimestamp, target)) {
    return { beforeOrAt, atOrAfter };
  }

  beforeOrAt =
    observations[Number((index + 1n) % cardinality)] ?? _emptyObservation();
  if (!beforeOrAt.initialized) beforeOrAt = observations[0];

  return binarySearch(observations, time, target, index, cardinality);
}

function observeSingle(
  observations: Observation[],
  intermediate: Observation,
  time: bigint,
  secondsAgo: bigint,
  tick: bigint,
  index: bigint,
  cardinality: bigint,
): bigint {
  if (secondsAgo === 0n) {
    if (intermediate.blockTimestamp !== time) {
      intermediate = transform(intermediate, time, tick);
    }
    return intermediate.tickCumulative;
  }

  const target = time - secondsAgo;

  const { beforeOrAt, atOrAfter } = getSurroundingObservations(
    observations,
    intermediate,
    time,
    target,
    tick,
    index,
    cardinality,
  );

  if (target === beforeOrAt.blockTimestamp) {
    return beforeOrAt.tickCumulative;
  } else if (target === atOrAfter.blockTimestamp) {
    return atOrAfter.tickCumulative;
  } else {
    const observationTimeDelta =
      atOrAfter.blockTimestamp - beforeOrAt.blockTimestamp;
    const targetDelta = target - beforeOrAt.blockTimestamp;
    return (
      beforeOrAt.tickCumulative +
      ((atOrAfter.tickCumulative - beforeOrAt.tickCumulative) /
        observationTimeDelta) *
        targetDelta
    );
  }
}

export function observeDouble(
  observations: Observation[],
  intermediate: Observation,
  time: bigint,
  secondsAgo0: bigint,
  secondsAgo1: bigint,
  tick: bigint,
  index: bigint,
  cardinality: bigint,
): { tickCumulative0: bigint; tickCumulative1: bigint } {
  return {
    tickCumulative0: observeSingle(
      observations,
      intermediate,
      time,
      secondsAgo0,
      tick,
      index,
      cardinality,
    ),
    tickCumulative1: observeSingle(
      observations,
      intermediate,
      time,
      secondsAgo1,
      tick,
      index,
      cardinality,
    ),
  };
}

export function observeTriple(
  observations: Observation[],
  intermediate: Observation,
  time: bigint,
  secondsAgo0: bigint,
  secondsAgo1: bigint,
  secondsAgo2: bigint,
  tick: bigint,
  index: bigint,
  cardinality: bigint,
): {
  tickCumulative0: bigint;
  tickCumulative1: bigint;
  tickCumulative2: bigint;
} {
  return {
    tickCumulative0: observeSingle(
      observations,
      intermediate,
      time,
      secondsAgo0,
      tick,
      index,
      cardinality,
    ),
    tickCumulative1: observeSingle(
      observations,
      intermediate,
      time,
      secondsAgo1,
      tick,
      index,
      cardinality,
    ),
    tickCumulative2: observeSingle(
      observations,
      intermediate,
      time,
      secondsAgo2,
      tick,
      index,
      cardinality,
    ),
  };
}

export function _observe(
  observations: Observation[],
  intermediate: Observation,
  time: bigint,
  secondsAgo: bigint[],
  tick: bigint,
  index: bigint,
  cardinality: bigint,
): bigint[] {
  const tickCumulatives: bigint[] = [];

  for (let i = 0; i < secondsAgo.length; i++) {
    tickCumulatives[i] = observeSingle(
      observations,
      intermediate,
      time,
      secondsAgo[i],
      tick,
      index,
      cardinality,
    );
  }

  return tickCumulatives;
}

function lte(time: bigint, a: bigint, b: bigint): boolean {
  if (a <= time && b <= time) return a <= b;

  const aAdjusted = a > time ? a : a + 2n ** 32n;
  const bAdjusted = b > time ? b : b + 2n ** 32n;

  return aAdjusted <= bAdjusted;
}

function _emptyObservation(): Observation {
  return {
    blockTimestamp: 0n,
    prevTick: 0n,
    tickCumulative: 0n,
    initialized: false,
  };
}
