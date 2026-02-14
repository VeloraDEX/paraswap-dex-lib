import { DeepReadonly } from 'ts-essentials';
import { ConcentratedPoolState } from './concentrated';
import { MAX_TICK, MIN_TICK, toSqrtRatio } from './math/tick';
import { quoteMevCapture } from './mev-capture';
import { ConcentratedPoolTypeConfig, PoolConfig, PoolKey } from './utils';

describe(quoteMevCapture, () => {
  function quoteFn(tickSpacing: number, fee: bigint) {
    const key = new PoolKey(
      1n,
      2n,
      new PoolConfig(1n, fee, new ConcentratedPoolTypeConfig(tickSpacing)),
    );
    return (
      amount: bigint,
      isToken1: boolean,
      state: DeepReadonly<ConcentratedPoolState.Object>,
      sqrtRatioLimit?: bigint,
    ) => quoteMevCapture(key, amount, isToken1, state, sqrtRatioLimit);
  }

  test('input amount token0', () => {
    const quote = quoteFn(20_000, (1n << 64n) / 100n);

    const liquidity = 28_898_102n;
    const state: ConcentratedPoolState.Object = {
      activeTick: 700_000,
      activeTickIndex: 0,
      checkedTicksBounds: [MIN_TICK, MAX_TICK],
      liquidity,
      sortedTicks: [
        {
          number: 600_000,
          liquidityDelta: liquidity,
        },
        {
          number: 800_000,
          liquidityDelta: -liquidity,
        },
      ],
      sqrtRatio: toSqrtRatio(700_000),
    };

    // One swap
    {
      const q = quote(100_000n, false, state);

      expect(q.consumedAmount).toBe(100_000n);
      expect(q.calculatedAmount).toBe(197_432n);
    }

    // Two swaps
    {
      let q = quote(300_000n, false, state);

      q = quote(300_000n, false, Object.assign(state, q.stateAfter));

      expect(q.consumedAmount).toBe(300_000n);
      expect(q.calculatedAmount).toBe(556_308n);
    }
  });

  test('output amount token0', () => {
    const quote = quoteFn(20_000, (1n << 64n) / 100n);

    const liquidity = 28_898_102n;
    const state: ConcentratedPoolState.Object = {
      activeTick: 700_000,
      activeTickIndex: 0,
      checkedTicksBounds: [MIN_TICK, MAX_TICK],
      liquidity,
      sortedTicks: [
        {
          number: 600_000,
          liquidityDelta: liquidity,
        },
        {
          number: 800_000,
          liquidityDelta: -liquidity,
        },
      ],
      sqrtRatio: toSqrtRatio(700_000),
    };

    const q = quote(-100_000n, false, state);

    expect(q.consumedAmount).toBe(-100_000n);
    expect(q.calculatedAmount).toBe(205_416n);
  });

  test('example mainnet', () => {
    const quote = quoteFn(1000, 9223372036854775n);

    const liquidity = 187957823162863064741n;
    const state: ConcentratedPoolState.Object = {
      activeTick: 8015514,
      activeTickIndex: 0,
      checkedTicksBounds: [MIN_TICK, MAX_TICK],
      liquidity,
      sortedTicks: [
        {
          number: 7755000,
          liquidityDelta: liquidity,
        },
        {
          number: 8267000,
          liquidityDelta: -liquidity,
        },
      ],
      sqrtRatio: 18723430188006331344089883003460461264896n,
    };

    {
      const specifiedAmount = 1000000000000000n;
      const q = quote(specifiedAmount, false, state);

      expect(q.consumedAmount).toBe(specifiedAmount);
      expect(q.calculatedAmount).toBe(3024269006844199936n);
    }

    {
      const specifiedAmount = 5000000000000000n;
      const q = quote(specifiedAmount, false, state);

      expect(q.consumedAmount).toBe(specifiedAmount);
      expect(q.calculatedAmount).toBe(15086011739862955657n);
    }
  });

  test('example mainnet split trade', () => {
    const quote = quoteFn(1000, 9223372036854775n);

    const liquidity = 187957823162863064741n;
    const state: ConcentratedPoolState.Object = {
      activeTick: 8092285,
      activeTickIndex: 0,
      checkedTicksBounds: [MIN_TICK, MAX_TICK],
      liquidity,
      sortedTicks: [
        {
          number: 7755000,
          liquidityDelta: liquidity,
        },
        {
          number: 8267000,
          liquidityDelta: -liquidity,
        },
      ],
      sqrtRatio: 19456111242847136401729567804224169836544n,
    };

    const sqrtRatioLimit = 18447191164202170524n;

    const q0 = quote(125000000000000000n, false, state, sqrtRatioLimit);

    expect(q0.consumedAmount).toBe(125000000000000000n);
    expect(q0.calculatedAmount).toBe(378805738986174441222n);

    const q1 = quote(
      50000000000000000n,
      false,
      Object.assign(state, q0.stateAfter),
      sqrtRatioLimit,
    );

    expect(q1.consumedAmount).toBe(50000000000000000n);
    expect(q1.calculatedAmount).toBe(141694588268248470538n);

    const q2 = quote(
      12500000000000000n,
      false,
      Object.assign(state, q1.stateAfter),
      sqrtRatioLimit,
    );

    expect(q2.consumedAmount).toBe(12500000000000000n);
    expect(q2.calculatedAmount).toBe(34654649033984065500n);

    const q3 = quote(
      12500000000000000n,
      false,
      Object.assign(state, q2.stateAfter),
      sqrtRatioLimit,
    );

    expect(q3.consumedAmount).toBe(12500000000000000n);
    expect(q3.calculatedAmount).toBe(34275601333991479466n);
  });
});
