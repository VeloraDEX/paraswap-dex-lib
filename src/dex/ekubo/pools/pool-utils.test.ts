import { MAX_TICK, MIN_TICK } from './math/tick';
import { Tick } from '../types';
import { PoolState } from './pool-utils';

const positiveLiquidity = 10n;

const checkedTickNumberBounds: [number, number] = [-2, 2];
const [minCheckedTickNumber, maxCheckedTickNumber] = checkedTickNumberBounds;
const [minCheckedTickUninitialized, maxCheckedTickUninitialized]: [Tick, Tick] =
  [
    {
      number: minCheckedTickNumber,
      liquidityDelta: 0n,
    },
    {
      number: maxCheckedTickNumber,
      liquidityDelta: 0n,
    },
  ];
const [betweenMinAndActiveTickNumber, betweenActiveAndMaxTickNumber] = [-1, 1];
const activeTickNumber = 0;

function poolState(
  activeTickIndex: number | null,
  liquidity: bigint,
  sortedTicks: Tick[],
): PoolState.Object {
  return {
    activeTick: activeTickNumber,
    activeTickIndex,
    checkedTicksBounds: checkedTickNumberBounds,
    liquidity,
    sortedTicks,
    sqrtRatio: 0n, // Irrelevant for these tests
  };
}

describe('addLiquidityCutoffs', () => {
  test('empty ticks', () => {
    const state = poolState(null, 0n, []);

    PoolState.addLiquidityCutoffs(state);

    expect(state.sortedTicks).toStrictEqual([
      minCheckedTickUninitialized,
      maxCheckedTickUninitialized,
    ]);
    expect(state.activeTickIndex).toStrictEqual(0);
  });

  describe('positive liquidity delta', () => {
    const liquidityDelta = positiveLiquidity;

    test('initialized active tick', () => {
      const activeTickInitialized = {
        number: activeTickNumber,
        liquidityDelta,
      };
      const sortedTicks = [structuredClone(activeTickInitialized)];

      const state = poolState(0, positiveLiquidity, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        activeTickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toStrictEqual(1);
    });

    test('initialized minCheckedTick', () => {
      const minCheckedTickInitialized = {
        number: minCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(minCheckedTickInitialized)];

      const state = poolState(0, liquidityDelta, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toStrictEqual(0);
    });

    test('initialized maxCheckedTick', () => {
      const maxCheckedTickInitialized = {
        number: maxCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [maxCheckedTickInitialized];

      const state = poolState(null, 0n, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toStrictEqual(0);
    });

    test('initialized minCheckedTick < tick < activeTick', () => {
      const tickInitialized = {
        number: betweenMinAndActiveTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(0, liquidityDelta, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        tickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toStrictEqual(1);
    });

    test('initialized activeTick < tick < maxCheckedTick', () => {
      const tickInitialized = {
        number: betweenActiveAndMaxTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(null, 0n, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        tickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toStrictEqual(0);
    });
  });

  describe('negative liquidity delta', () => {
    const liquidityDelta = -positiveLiquidity;

    test('initialized active tick', () => {
      const activeTickInitialized = {
        number: activeTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(activeTickInitialized)];

      const state = poolState(0, 0n, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        activeTickInitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toStrictEqual(1);
    });

    test('initialized minCheckedTick', () => {
      const minCheckedTickInitialized = {
        number: minCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(minCheckedTickInitialized)];

      const state = poolState(0, 0n, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toStrictEqual(0);
    });

    test('initialized maxCheckedTick', () => {
      const maxCheckedTickInitialized = {
        number: maxCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(maxCheckedTickInitialized)];

      const state = poolState(null, -liquidityDelta, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        maxCheckedTickInitialized,
      ]);
      expect(state.activeTickIndex).toStrictEqual(0);
    });

    test('initialized minCheckedTick < tick < activeTick', () => {
      const tickInitialized = {
        number: betweenMinAndActiveTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(0, 0n, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        tickInitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toStrictEqual(1);
    });

    test('initialized activeTick < tick < maxCheckedTick', () => {
      const tickInitialized = {
        number: betweenActiveAndMaxTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(null, -liquidityDelta, sortedTicks);

      PoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        tickInitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toStrictEqual(0);
    });
  });
});

describe('fromPositionUpdatedEvent', () => {
  describe('empty ticks', () => {
    const stateBefore = poolState(0, 0n, [
      minCheckedTickUninitialized,
      maxCheckedTickUninitialized,
    ]);

    test('between checked bounds', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [betweenMinAndActiveTickNumber, betweenActiveAndMaxTickNumber],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        {
          number: betweenMinAndActiveTickNumber,
          liquidityDelta: positiveLiquidity,
        },
        {
          number: betweenActiveAndMaxTickNumber,
          liquidityDelta: -positiveLiquidity,
        },
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(1);
      expect(stateAfter?.liquidity).toStrictEqual(positiveLiquidity);
    });

    test('upper in checked bounds', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, betweenActiveAndMaxTickNumber],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: positiveLiquidity,
        },
        {
          number: betweenActiveAndMaxTickNumber,
          liquidityDelta: -positiveLiquidity,
        },
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(positiveLiquidity);
    });

    test('lower in checked bounds', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [betweenMinAndActiveTickNumber, MAX_TICK],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        {
          number: betweenMinAndActiveTickNumber,
          liquidityDelta: positiveLiquidity,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity,
        },
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(1);
      expect(stateAfter?.liquidity).toStrictEqual(positiveLiquidity);
    });

    test('below checked bounds', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, MIN_TICK + 1],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });

    test('above checked bounds', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MAX_TICK - 1, MAX_TICK],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });

    test('referenced lower bound', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, minCheckedTickNumber],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });

    test('referenced upper bound', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [maxCheckedTickNumber, MAX_TICK],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });
  });

  describe('active tick initialized', () => {
    const stateBefore = poolState(1, positiveLiquidity, [
      minCheckedTickUninitialized,
      {
        number: activeTickNumber,
        liquidityDelta: positiveLiquidity,
      },
      {
        number: maxCheckedTickNumber,
        liquidityDelta: -positiveLiquidity,
      },
    ]);

    test('modify delta', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [activeTickNumber, MAX_TICK],
        -positiveLiquidity / 2n,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        {
          number: activeTickNumber,
          liquidityDelta: positiveLiquidity / 2n,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity / 2n,
        },
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(1);
      expect(stateAfter?.liquidity).toStrictEqual(positiveLiquidity / 2n);
    });

    test('close position', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [activeTickNumber, MAX_TICK],
        -positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });
  });

  describe('minCheckedTick initialized', () => {
    const stateBefore = poolState(0, positiveLiquidity, [
      {
        number: minCheckedTickNumber,
        liquidityDelta: positiveLiquidity,
      },
      {
        number: maxCheckedTickNumber,
        liquidityDelta: -positiveLiquidity,
      },
    ]);

    test('modify delta', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [minCheckedTickNumber, MAX_TICK],
        -positiveLiquidity / 2n,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: positiveLiquidity / 2n,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity / 2n,
        },
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(positiveLiquidity / 2n);
    });

    test('close position', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [minCheckedTickNumber, MAX_TICK],
        -positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });
  });

  describe('maxCheckedTick initialized', () => {
    const stateBefore = poolState(0, positiveLiquidity, [
      {
        number: minCheckedTickNumber,
        liquidityDelta: positiveLiquidity,
      },
      {
        number: maxCheckedTickNumber,
        liquidityDelta: -positiveLiquidity,
      },
    ]);

    test('modify delta', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, maxCheckedTickNumber],
        -positiveLiquidity / 2n,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: positiveLiquidity / 2n,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity / 2n,
        },
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(positiveLiquidity / 2n);
    });

    test('close position', () => {
      const stateAfter = PoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, maxCheckedTickNumber],
        -positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toStrictEqual(0);
      expect(stateAfter?.liquidity).toStrictEqual(0n);
    });
  });
});
