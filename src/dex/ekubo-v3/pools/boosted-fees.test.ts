import { DeepReadonly } from 'ts-essentials';
import { BoostedFeesPool, BoostedFeesPoolState } from './boosted-fees';
import { BasePoolState } from './base';
import { MAX_TICK, MIN_TICK, toSqrtRatio } from './math/tick';
import { ConcentratedPoolTypeConfig, PoolConfig, PoolKey } from './utils';

function state(overrides?: Partial<BoostedFeesPoolState.Object>) {
  const base: BoostedFeesPoolState.Object = {
    sqrtRatio: toSqrtRatio(0),
    liquidity: 1_000_000n,
    activeTick: 0,
    activeTickIndex: 0,
    sortedTicks: [
      { number: -10, liquidityDelta: 1_000_000n },
      { number: 10, liquidityDelta: -1_000_000n },
    ],
    checkedTicksBounds: [MIN_TICK, MAX_TICK],
    timedPoolState: {
      token0Rate: 0n,
      token1Rate: 0n,
      lastTime: 100n,
      virtualDeltas: [],
    },
  };

  return Object.assign(base, overrides);
}

describe(BoostedFeesPoolState.fromFeesDonatedEvent, () => {
  test('updates last donate time and donate rates', () => {
    const updated = BoostedFeesPoolState.fromFeesDonatedEvent(
      state(),
      { donateRate0: 123n, donateRate1: 456n },
      777n,
    )!;

    expect(updated.timedPoolState.lastTime).toBe(777n);
    expect(updated.timedPoolState.token0Rate).toBe(123n);
    expect(updated.timedPoolState.token1Rate).toBe(456n);
  });

  test('prunes old deltas', () => {
    const updated = BoostedFeesPoolState.fromFeesDonatedEvent(
      state({
        timedPoolState: {
          token0Rate: 0n,
          token1Rate: 0n,
          lastTime: 100n,
          virtualDeltas: [
            { time: 100n, delta0: 1n, delta1: 2n },
            { time: 120n, delta0: 3n, delta1: 4n },
            { time: 140n, delta0: 5n, delta1: 6n },
          ],
        },
      }),
      { donateRate0: 1n, donateRate1: 2n },
      120n,
    )!;

    expect(updated.timedPoolState.virtualDeltas).toEqual([
      { time: 140n, delta0: 5n, delta1: 6n },
    ]);
  });
});

describe(BoostedFeesPoolState.fromPoolBoostedEvent, () => {
  test('ignores no-op event', () => {
    expect(
      BoostedFeesPoolState.fromPoolBoostedEvent(
        state(),
        [200n, 300n],
        [0n, 0n],
      ),
    ).toBeNull();
  });

  test('adds future donate deltas for start and end boundaries', () => {
    const updated = BoostedFeesPoolState.fromPoolBoostedEvent(
      state(),
      [200n, 300n],
      [10n, 20n],
    )!;

    expect(updated.timedPoolState.token0Rate).toBe(0n);
    expect(updated.timedPoolState.token1Rate).toBe(0n);
    expect(updated.timedPoolState.virtualDeltas).toEqual([
      {
        time: 200n,
        delta0: 10n,
        delta1: 20n,
      },
      {
        time: 300n,
        delta0: -10n,
        delta1: -20n,
      },
    ]);
  });

  test('applies already-started boundary to base donate rates', () => {
    const updated = BoostedFeesPoolState.fromPoolBoostedEvent(
      state({
        timedPoolState: {
          token0Rate: 0n,
          token1Rate: 0n,
          lastTime: 250n,
          virtualDeltas: [],
        },
      }),
      [200n, 300n],
      [10n, 20n],
    )!;

    expect(updated.timedPoolState.token0Rate).toBe(10n);
    expect(updated.timedPoolState.token1Rate).toBe(20n);
    expect(updated.timedPoolState.virtualDeltas).toEqual([
      {
        time: 300n,
        delta0: -10n,
        delta1: -20n,
      },
    ]);
  });

  test('removes delta entries when updates cancel them out', () => {
    const updated = BoostedFeesPoolState.fromPoolBoostedEvent(
      state({
        timedPoolState: {
          token0Rate: 0n,
          token1Rate: 0n,
          lastTime: 100n,
          virtualDeltas: [
            {
              time: 200n,
              delta0: -5n,
              delta1: -7n,
            },
          ],
        },
      }),
      [200n, 250n],
      [5n, 7n],
    )!;

    expect(updated.timedPoolState.virtualDeltas).toEqual([
      {
        time: 250n,
        delta0: -5n,
        delta1: -7n,
      },
    ]);
  });
});

describe('Boosted fees state compatibility', () => {
  test('base swap event transition keeps donate tracking state', () => {
    const current = state({
      timedPoolState: {
        token0Rate: 11n,
        token1Rate: 22n,
        lastTime: 100n,
        virtualDeltas: [{ time: 300n, delta0: 1n, delta1: 2n }],
      },
    });

    const swapped = BoostedFeesPoolState.fromSwappedEvent(current, {
      tickAfter: 1,
      sqrtRatioAfter: toSqrtRatio(1),
      liquidityAfter: 2_000_000n,
    });

    expect(swapped.timedPoolState.token0Rate).toBe(11n);
    expect(swapped.timedPoolState.token1Rate).toBe(22n);
    expect(swapped.timedPoolState.virtualDeltas).toEqual(
      current.timedPoolState.virtualDeltas,
    );
    expect(swapped.activeTick).toBe(1);
    expect(swapped.sqrtRatio).toBe(toSqrtRatio(1));
    expect(swapped.liquidity).toBe(2_000_000n);
  });

  test('position update transition keeps donate tracking state', () => {
    const current = state({
      timedPoolState: {
        token0Rate: 11n,
        token1Rate: 22n,
        lastTime: 100n,
        virtualDeltas: [{ time: 300n, delta0: 1n, delta1: 2n }],
      },
    });

    const updated = BoostedFeesPoolState.fromPositionUpdatedEvent(
      current,
      [-5, 5],
      123n,
    );

    expect(updated).not.toBeNull();
    const next = updated as BasePoolState.Object & {
      timedPoolState: {
        token0Rate: bigint;
        token1Rate: bigint;
        virtualDeltas: BoostedFeesPoolState.DonateRateDelta[];
      };
    };
    expect(next.timedPoolState.token0Rate).toBe(11n);
    expect(next.timedPoolState.token1Rate).toBe(22n);
    expect(next.timedPoolState.virtualDeltas).toEqual(
      current.timedPoolState.virtualDeltas,
    );
  });
});

describe(BoostedFeesPool.prototype.quoteBoostedFees, () => {
  function quote(
    amount: bigint,
    isToken1: boolean,
    quoteState: DeepReadonly<BoostedFeesPoolState.Object>,
    timestamp: bigint,
  ) {
    return BoostedFeesPool.prototype.quoteBoostedFees.call(
      {
        key: new PoolKey(
          0n,
          1n,
          new PoolConfig(0n, 0n, new ConcentratedPoolTypeConfig(1)),
        ),
      },
      amount,
      isToken1,
      quoteState,
      undefined,
      timestamp,
    );
  }

  test('same timestamp noop', () => {
    const q = quote(
      0n,
      false,
      state({
        timedPoolState: {
          token0Rate: 0n,
          token1Rate: 0n,
          lastTime: 100n,
          virtualDeltas: [],
        },
      }),
      100n,
    );

    expect(q.stateAfter.timedPoolState.lastTime).toBe(100n);
    expect(q.stateAfter.timedPoolState.token0Rate).toBe(0n);
    expect(q.stateAfter.timedPoolState.token1Rate).toBe(0n);
  });

  test('tracks time without deltas', () => {
    const q = quote(
      0n,
      false,
      state({
        timedPoolState: {
          token0Rate: 0n,
          token1Rate: 0n,
          lastTime: 100n,
          virtualDeltas: [],
        },
      }),
      150n,
    );

    expect(q.stateAfter.timedPoolState.lastTime).toBe(150n);
    expect(q.stateAfter.timedPoolState.token0Rate).toBe(0n);
    expect(q.stateAfter.timedPoolState.token1Rate).toBe(0n);
  });

  test('applies deltas', () => {
    const rate = 1n << 32n;
    const q = quote(
      0n,
      false,
      state({
        timedPoolState: {
          token0Rate: rate,
          token1Rate: 0n,
          lastTime: 0n,
          virtualDeltas: [
            {
              time: 200n,
              delta0: -rate,
              delta1: 0n,
            },
          ],
        },
      }),
      300n,
    );

    expect(q.stateAfter.timedPoolState.lastTime).toBe(300n);
    expect(q.stateAfter.timedPoolState.token0Rate).toBe(0n);
    expect(q.stateAfter.timedPoolState.token1Rate).toBe(0n);
  });

  test('ignores future deltas', () => {
    const rate = 1n << 32n;
    const q = quote(
      0n,
      false,
      state({
        timedPoolState: {
          token0Rate: 0n,
          token1Rate: 0n,
          lastTime: 100n,
          virtualDeltas: [
            {
              time: 200n,
              delta0: rate,
              delta1: 0n,
            },
            {
              time: 300n,
              delta0: -rate,
              delta1: 0n,
            },
          ],
        },
      }),
      150n,
    );

    expect(q.stateAfter.timedPoolState.lastTime).toBe(150n);
    expect(q.stateAfter.timedPoolState.token0Rate).toBe(0n);
    expect(q.stateAfter.timedPoolState.token1Rate).toBe(0n);
  });
});
