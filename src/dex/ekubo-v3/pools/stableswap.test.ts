import { DeepReadonly } from 'ts-essentials';
import { amount0Delta, amount1Delta } from './math/delta';
import { MIN_TICK, MAX_TICK, toSqrtRatio } from './math/tick';
import { FullRangePoolState } from './full-range';
import { Quote } from './pool';
import { PoolConfig, PoolKey, StableswapPoolTypeConfig } from './utils';
import { computeStableswapBounds, quoteStableswap } from './stableswap';

const POSITION_AMOUNT = 1_000_000_000_000_000_000n;
const SMALL_AMOUNT = 1_000_000_000_000_000n;
const U128_MAX = (1n << 128n) - 1n;

function quote(
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<FullRangePoolState.Object>,
  poolTypeConfig: StableswapPoolTypeConfig,
  fee: bigint = 0n,
): Quote<FullRangePoolState.Object> {
  return quoteStableswap(
    fee,
    computeStableswapBounds(poolTypeConfig),
    amount,
    isToken1,
    state,
  );
}

function activeRange(
  centerTick: number,
  amplification: number,
): [number, number] {
  const width = MAX_TICK >> amplification;
  const lower = Math.max(centerTick - width, MIN_TICK);
  const upper = Math.min(centerTick + width, MAX_TICK);
  return [lower, upper];
}

function requiredAmounts(
  liquidity: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  sqrtCurrent: bigint,
): [bigint, bigint] | null {
  if (sqrtCurrent <= sqrtLower) {
    const needed0 = amount0Delta(sqrtLower, sqrtUpper, liquidity, true);
    return [needed0, 0n];
  }

  if (sqrtCurrent >= sqrtUpper) {
    const needed1 = amount1Delta(sqrtLower, sqrtUpper, liquidity, true);
    return [0n, needed1];
  }

  const needed0 = amount0Delta(sqrtCurrent, sqrtUpper, liquidity, true);
  const needed1 = amount1Delta(sqrtLower, sqrtCurrent, liquidity, true);
  return [needed0, needed1];
}

function withinBudget(
  liquidity: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  sqrtCurrent: bigint,
): boolean {
  const needed = requiredAmounts(liquidity, sqrtLower, sqrtUpper, sqrtCurrent);
  if (!needed) return false;

  const [needed0, needed1] = needed;
  return needed0 <= POSITION_AMOUNT && needed1 <= POSITION_AMOUNT;
}

function mintedLiquidity(
  centerTick: number,
  amplification: number,
  currentTick: number,
): bigint {
  const [lowerTick, upperTick] = activeRange(centerTick, amplification);
  const sqrtLower = toSqrtRatio(lowerTick);
  const sqrtUpper = toSqrtRatio(upperTick);
  const sqrtCurrent = toSqrtRatio(currentTick);

  let low = 0n;
  let high = U128_MAX;

  while (low < high) {
    const mid = low + (high - low) / 2n + 1n;
    if (withinBudget(mid, sqrtLower, sqrtUpper, sqrtCurrent)) {
      low = mid;
    } else {
      high = mid - 1n;
    }
  }

  return low;
}

function stateFromTick(
  tick: number,
  liquidity: bigint,
): FullRangePoolState.Object {
  return {
    sqrtRatio: toSqrtRatio(tick),
    liquidity,
  };
}

describe(quoteStableswap, () => {
  test('amplification 26 token0 in', () => {
    const poolTypeConfig = new StableswapPoolTypeConfig(0, 26);
    const liquidity = mintedLiquidity(0, 26, 0);
    const res = quote(
      SMALL_AMOUNT,
      false,
      stateFromTick(0, liquidity),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBe(SMALL_AMOUNT);
    expect(res.calculatedAmount).toBe(999_999_999_500_000n);
  });

  test('amplification 26 token1 in', () => {
    const poolTypeConfig = new StableswapPoolTypeConfig(0, 26);
    const liquidity = mintedLiquidity(0, 26, 0);
    const res = quote(
      SMALL_AMOUNT,
      true,
      stateFromTick(0, liquidity),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBe(SMALL_AMOUNT);
    expect(res.calculatedAmount).toBe(999_999_999_500_000n);
  });

  test('amplification 1 token0 in', () => {
    const poolTypeConfig = new StableswapPoolTypeConfig(0, 1);
    const liquidity = mintedLiquidity(0, 1, 0);
    const res = quote(
      SMALL_AMOUNT,
      false,
      stateFromTick(0, liquidity),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBe(SMALL_AMOUNT);
    expect(res.calculatedAmount).toBe(999_000_999_001_231n);
  });

  test('amplification 1 token1 in', () => {
    const poolTypeConfig = new StableswapPoolTypeConfig(0, 1);
    const liquidity = mintedLiquidity(0, 1, 0);
    const res = quote(
      SMALL_AMOUNT,
      true,
      stateFromTick(0, liquidity),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBe(SMALL_AMOUNT);
    expect(res.calculatedAmount).toBe(999_000_999_001_231n);
  });

  test('outside range has no liquidity', () => {
    const amplification = 10;
    const [_, upper] = activeRange(0, amplification);
    const outsideTick = Math.min(upper + 1_000, MAX_TICK);
    const liquidity = mintedLiquidity(0, amplification, outsideTick);
    const poolTypeConfig = new StableswapPoolTypeConfig(0, amplification);
    const res = quote(
      SMALL_AMOUNT,
      true,
      stateFromTick(outsideTick, liquidity),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBe(0n);
    expect(res.calculatedAmount).toBe(0n);
    expect(res.stateAfter.sqrtRatio).toBeGreaterThanOrEqual(
      computeStableswapBounds(poolTypeConfig).upperPrice,
    );
  });

  test('swap through range boundary', () => {
    const amplification = 10;
    const [lower, upper] = activeRange(0, amplification);
    const startTick = upper - 100;
    const poolTypeConfig = new StableswapPoolTypeConfig(0, amplification);
    const res = quote(
      1_000_000_000_000_000_000n,
      false,
      stateFromTick(startTick, mintedLiquidity(0, amplification, startTick)),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBeGreaterThan(0n);
    expect(res.calculatedAmount).toBeGreaterThan(0n);
    expect(res.stateAfter.sqrtRatio).toBeLessThanOrEqual(
      toSqrtRatio(lower + 10),
    );
  });

  test('exact out above upper boundary does not hang', () => {
    const amplification = 26;
    const [_, upper] = activeRange(0, amplification);
    const outsideTick = Math.min(upper + 1_000, MAX_TICK);
    const liquidity = mintedLiquidity(0, amplification, outsideTick);
    const poolTypeConfig = new StableswapPoolTypeConfig(0, amplification);
    const { upperPrice } = computeStableswapBounds(poolTypeConfig);

    const res = quote(
      -SMALL_AMOUNT,
      true,
      {
        sqrtRatio: upperPrice,
        liquidity,
      },
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBeLessThanOrEqual(0n);
  });

  test('inside range has liquidity', () => {
    const amplification = 10;
    const [lower, upper] = activeRange(0, amplification);
    const midTick = Math.trunc((lower + upper) / 2);
    const poolTypeConfig = new StableswapPoolTypeConfig(0, amplification);
    const res = quote(
      SMALL_AMOUNT,
      false,
      stateFromTick(midTick, mintedLiquidity(0, amplification, midTick)),
      poolTypeConfig,
    );

    expect(res.consumedAmount).toBe(SMALL_AMOUNT);
    expect(res.calculatedAmount).toBeGreaterThan(0n);
    expect(res.calculatedAmount).toBeLessThan(SMALL_AMOUNT);
  });
});
