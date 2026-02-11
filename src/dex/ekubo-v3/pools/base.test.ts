import { BigNumber } from 'ethers';
import {
  BasePool,
  BasePoolState,
  findNearestInitializedTickIndex,
  Tick,
} from './base';
import { TWO_POW_128 } from './math/constants';
import { MAX_SQRT_RATIO, MAX_TICK, MIN_TICK, toSqrtRatio } from './math/tick';
import {
  ConcentratedPoolTypeConfig,
  PoolConfig,
  PoolKey,
  SwappedEvent,
} from './utils';
import { ONE_FLOAT_SQRT_RATIO } from './math/sqrt-ratio';

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
  sortedTicks: Tick[],
  activeTickIndex: number | null,
  liquidity: bigint,
  sqrtRatio: bigint = TWO_POW_128,
): BasePoolState.Object {
  return {
    activeTick: activeTickNumber,
    activeTickIndex,
    checkedTicksBounds: checkedTickNumberBounds,
    liquidity,
    sortedTicks,
    sqrtRatio,
  };
}

describe(BasePool.prototype.quoteBase, () => {
  function quote(
    amount: bigint,
    isToken1: boolean,
    state: BasePoolState.Object,
    fee: bigint,
    tickSpacing: number,
  ) {
    return BasePool.prototype.quoteBase.call(
      {
        key: new PoolKey(
          0n,
          1n,
          new PoolConfig(0n, fee, new ConcentratedPoolTypeConfig(tickSpacing)),
        ),
      },
      amount,
      isToken1,
      state,
    );
  }

  test('zero liquidity token1 input', () => {
    const q = quote(1000n, true, poolState([], null, 0n), 0n, 1);

    expect(q.calculatedAmount).toBe(0n);
  });

  test('zero liquidity token0 input', () => {
    const q = quote(1000n, false, poolState([], null, 0n), 0n, 1);

    expect(q.calculatedAmount).toBe(0n);
  });

  test('liquidity token1 input', () => {
    const q = quote(
      1000n,
      true,
      poolState(
        [
          {
            number: 0,
            liquidityDelta: 1_000_000_000n,
          },
          {
            number: 1,
            liquidityDelta: -1_000_000_000n,
          },
        ],
        0,
        1_000_000_000n,
        TWO_POW_128,
      ),
      0n,
      1,
    );

    expect(q.calculatedAmount).toBe(499n);
  });

  test('liquidity token0 input', () => {
    const q = quote(
      1000n,
      false,
      poolState(
        [
          {
            number: 0,
            liquidityDelta: 1_000_000_000n,
          },
          {
            number: 1,
            liquidityDelta: -1_000_000_000n,
          },
        ],
        1,
        0n,
        toSqrtRatio(1),
      ),
      0n,
      1,
    );

    expect(q.calculatedAmount).toBe(499n);
  });

  test('example', () => {
    const state = poolState(
      [
        {
          number: -88722000,
          liquidityDelta: 99999n,
        },
        {
          number: -24124600,
          liquidityDelta: 103926982998885n,
        },
        {
          number: -24124500,
          liquidityDelta: -103926982998885n,
        },
        {
          number: -20236100,
          liquidityDelta: 20192651866847n,
        },
        {
          number: -20235900,
          liquidityDelta: 676843433645n,
        },
        {
          number: -20235400,
          liquidityDelta: 620315686813n,
        },
        {
          number: -20235000,
          liquidityDelta: 3899271022058n,
        },
        {
          number: -20234900,
          liquidityDelta: 1985516133391n,
        },
        {
          number: -20233000,
          liquidityDelta: 2459469409600n,
        },
        {
          number: -20232100,
          liquidityDelta: -20192651866847n,
        },
        {
          number: -20231900,
          liquidityDelta: -663892969024n,
        },
        {
          number: -20231400,
          liquidityDelta: -620315686813n,
        },
        {
          number: -20231000,
          liquidityDelta: -3516445235227n,
        },
        {
          number: -20230900,
          liquidityDelta: -1985516133391n,
        },
        {
          number: -20229000,
          liquidityDelta: -2459469409600n,
        },
        {
          number: -20227900,
          liquidityDelta: -12950464621n,
        },
        {
          number: -20227000,
          liquidityDelta: -382825786831n,
        },
        {
          number: -2000,
          liquidityDelta: 140308196n,
        },
        {
          number: 2000,
          liquidityDelta: -140308196n,
        },
        {
          number: 88722000,
          liquidityDelta: -99999n,
        },
      ],
      16,
      99999n,
      13967539110995781342936001321080700n,
    );

    const fee = 922337203685477n;
    const tickSpacing = 100;

    {
      const q = quote(1000000n, false, state, fee, tickSpacing);
      expect(q.consumedAmount).toBe(1000000n);
      expect(q.calculatedAmount).toBe(0n);
    }

    {
      const q = quote(1000000n, true, state, fee, tickSpacing);
      expect(q.consumedAmount).toBe(1000000n);
      expect(q.calculatedAmount).toBe(2436479431n);
    }
  });
});

describe(findNearestInitializedTickIndex, () => {
  test('empty ticks', () => {
    expect(findNearestInitializedTickIndex([], 0)).toBe(null);
  });

  describe('single tick', () => {
    const ticks: Tick[] = [
      {
        number: 0,
        liquidityDelta: 1n,
      },
    ];

    test('lower', () => {
      expect(findNearestInitializedTickIndex(ticks, -1)).toBe(null);
    });

    test('equal', () => {
      expect(findNearestInitializedTickIndex(ticks, 0)).toBe(0);
    });

    test('higher', () => {
      expect(findNearestInitializedTickIndex(ticks, 1)).toBe(0);
    });
  });

  describe('three ticks', () => {
    const ticks: Tick[] = [
      {
        number: -2,
        liquidityDelta: 2n,
      },
      {
        number: 0,
        liquidityDelta: -1n,
      },
      {
        number: 2,
        liquidityDelta: -1n,
      },
    ];

    test('lower', () => {
      expect(findNearestInitializedTickIndex(ticks, -3)).toBe(null);
    });

    test('higher', () => {
      expect(findNearestInitializedTickIndex(ticks, 3)).toBe(2);
    });

    test('between', () => {
      expect(findNearestInitializedTickIndex(ticks, -1)).toBe(0);
      expect(findNearestInitializedTickIndex(ticks, 1)).toBe(1);
    });

    test('equal', () => {
      expect(findNearestInitializedTickIndex(ticks, -2)).toBe(0);
      expect(findNearestInitializedTickIndex(ticks, 0)).toBe(1);
      expect(findNearestInitializedTickIndex(ticks, 2)).toBe(2);
    });
  });
});

describe(BasePoolState.fromQuoter, () => {
  test('example', () => {
    expect(
      BasePoolState.fromQuoter({
        liquidity: BigNumber.from(1),
        maxTick: 5,
        minTick: -5,
        sqrtRatio: BigNumber.from(ONE_FLOAT_SQRT_RATIO),
        tick: 0,
        ticks: [
          {
            number: -2,
            liquidityDelta: BigNumber.from(1),
          },
          {
            number: 2,
            liquidityDelta: BigNumber.from(-1),
          },
        ],
      }),
    ).toStrictEqual<BasePoolState.Object>({
      activeTick: 0,
      activeTickIndex: 1,
      checkedTicksBounds: [-5, 5],
      liquidity: 1n,
      sortedTicks: [
        {
          number: -5,
          liquidityDelta: 0n,
        },
        {
          number: -2,
          liquidityDelta: 1n,
        },
        {
          number: 2,
          liquidityDelta: -1n,
        },
        {
          number: 5,
          liquidityDelta: 0n,
        },
      ],
      sqrtRatio: TWO_POW_128,
    });
  });
});

describe(BasePoolState.fromSwappedEvent, () => {
  test('example', () => {
    const ev: SwappedEvent = {
      liquidityAfter: 1n,
      sqrtRatioAfter: TWO_POW_128,
      tickAfter: 0,
    };

    const stateAfter = BasePoolState.fromSwappedEvent(
      {
        activeTick: MAX_TICK,
        activeTickIndex: 1,
        checkedTicksBounds: [MIN_TICK, MAX_TICK],
        liquidity: 0n,
        sortedTicks: [
          {
            number: MIN_TICK,
            liquidityDelta: 1n,
          },
          {
            number: MAX_TICK,
            liquidityDelta: -1n,
          },
        ],
        sqrtRatio: MAX_SQRT_RATIO,
      },
      ev,
    );

    expect(stateAfter.activeTick).toBe(ev.tickAfter);
    expect(stateAfter.activeTickIndex).toBe(0);
    expect(stateAfter.liquidity).toBe(ev.liquidityAfter);
    expect(stateAfter.sqrtRatio).toBe(ev.sqrtRatioAfter);
  });
});

describe(BasePoolState.fromPositionUpdatedEvent, () => {
  describe('empty ticks', () => {
    const stateBefore = poolState(
      [minCheckedTickUninitialized, maxCheckedTickUninitialized],
      0,
      0n,
    );

    test('between checked bounds', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
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
      expect(stateAfter?.activeTickIndex).toBe(1);
      expect(stateAfter?.liquidity).toBe(positiveLiquidity);
    });

    test('upper in checked bounds', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
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
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(positiveLiquidity);
    });

    test('lower in checked bounds', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
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
      expect(stateAfter?.activeTickIndex).toBe(1);
      expect(stateAfter?.liquidity).toBe(positiveLiquidity);
    });

    test('below checked bounds', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, MIN_TICK + 1],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });

    test('above checked bounds', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MAX_TICK - 1, MAX_TICK],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });

    test('referenced lower bound', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, minCheckedTickNumber],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });

    test('referenced upper bound', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [maxCheckedTickNumber, MAX_TICK],
        positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });
  });

  describe('active tick initialized', () => {
    const stateBefore = poolState(
      [
        minCheckedTickUninitialized,
        {
          number: activeTickNumber,
          liquidityDelta: positiveLiquidity,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity,
        },
      ],
      1,
      positiveLiquidity,
    );

    test('modify delta', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
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
      expect(stateAfter?.activeTickIndex).toBe(1);
      expect(stateAfter?.liquidity).toBe(positiveLiquidity / 2n);
    });

    test('close position', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [activeTickNumber, MAX_TICK],
        -positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });
  });

  describe('minCheckedTick initialized', () => {
    const stateBefore = poolState(
      [
        {
          number: minCheckedTickNumber,
          liquidityDelta: positiveLiquidity,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity,
        },
      ],
      0,
      positiveLiquidity,
    );

    test('modify delta', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
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
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(positiveLiquidity / 2n);
    });

    test('close position', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [minCheckedTickNumber, MAX_TICK],
        -positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });
  });

  describe('maxCheckedTick initialized', () => {
    const stateBefore = poolState(
      [
        {
          number: minCheckedTickNumber,
          liquidityDelta: positiveLiquidity,
        },
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -positiveLiquidity,
        },
      ],
      0,
      positiveLiquidity,
    );

    test('modify delta', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
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
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(positiveLiquidity / 2n);
    });

    test('close position', () => {
      const stateAfter = BasePoolState.fromPositionUpdatedEvent(
        stateBefore,
        [MIN_TICK, maxCheckedTickNumber],
        -positiveLiquidity,
      );

      expect(stateAfter?.sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(stateAfter?.activeTickIndex).toBe(0);
      expect(stateAfter?.liquidity).toBe(0n);
    });
  });
});

describe(BasePoolState.addLiquidityCutoffs, () => {
  test('empty ticks', () => {
    const state = poolState([], null, 0n);

    BasePoolState.addLiquidityCutoffs(state);

    expect(state.sortedTicks).toStrictEqual([
      minCheckedTickUninitialized,
      maxCheckedTickUninitialized,
    ]);
    expect(state.activeTickIndex).toBe(0);
  });

  describe('positive liquidity delta', () => {
    const liquidityDelta = positiveLiquidity;

    test('initialized active tick', () => {
      const activeTickInitialized = {
        number: activeTickNumber,
        liquidityDelta,
      };
      const sortedTicks = [structuredClone(activeTickInitialized)];

      const state = poolState(sortedTicks, 0, positiveLiquidity);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        activeTickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toBe(1);
    });

    test('initialized minCheckedTick', () => {
      const minCheckedTickInitialized = {
        number: minCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(minCheckedTickInitialized)];

      const state = poolState(sortedTicks, 0, liquidityDelta);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toBe(0);
    });

    test('initialized maxCheckedTick', () => {
      const maxCheckedTickInitialized = {
        number: maxCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [maxCheckedTickInitialized];

      const state = poolState(sortedTicks, null, 0n);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toBe(0);
    });

    test('initialized minCheckedTick < tick < activeTick', () => {
      const tickInitialized = {
        number: betweenMinAndActiveTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(sortedTicks, 0, liquidityDelta);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        tickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toBe(1);
    });

    test('initialized activeTick < tick < maxCheckedTick', () => {
      const tickInitialized = {
        number: betweenActiveAndMaxTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(sortedTicks, null, 0n);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        tickInitialized,
        {
          number: maxCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
      ]);
      expect(state.activeTickIndex).toBe(0);
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

      const state = poolState(sortedTicks, 0, 0n);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        activeTickInitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toBe(1);
    });

    test('initialized minCheckedTick', () => {
      const minCheckedTickInitialized = {
        number: minCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(minCheckedTickInitialized)];

      const state = poolState(sortedTicks, 0, 0n);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        minCheckedTickUninitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toBe(0);
    });

    test('initialized maxCheckedTick', () => {
      const maxCheckedTickInitialized = {
        number: maxCheckedTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(maxCheckedTickInitialized)];

      const state = poolState(sortedTicks, null, -liquidityDelta);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        maxCheckedTickInitialized,
      ]);
      expect(state.activeTickIndex).toBe(0);
    });

    test('initialized minCheckedTick < tick < activeTick', () => {
      const tickInitialized = {
        number: betweenMinAndActiveTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(sortedTicks, 0, 0n);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        tickInitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toBe(1);
    });

    test('initialized activeTick < tick < maxCheckedTick', () => {
      const tickInitialized = {
        number: betweenActiveAndMaxTickNumber,
        liquidityDelta: liquidityDelta,
      };
      const sortedTicks: Tick[] = [structuredClone(tickInitialized)];

      const state = poolState(sortedTicks, null, -liquidityDelta);

      BasePoolState.addLiquidityCutoffs(state);

      expect(sortedTicks).toEqual([
        {
          number: minCheckedTickNumber,
          liquidityDelta: -liquidityDelta,
        },
        tickInitialized,
        maxCheckedTickUninitialized,
      ]);
      expect(state.activeTickIndex).toBe(0);
    });
  });
});
