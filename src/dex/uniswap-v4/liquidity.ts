import { TickMath } from '../uniswap-v3/contract-math/TickMath';
import { PoolState } from './types';

const Q96 = BigInt(2) ** BigInt(96);

/**
 * Calculates the amount of token0 and token1 for a given liquidity,
 * current price, and tick range.
 */
function getAmountsForLiquidity(
  currentSqrtPriceX96: bigint,
  tickLower: bigint,
  tickUpper: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const sqrtPriceLowerX96 = TickMath.getSqrtRatioAtTick(tickLower);
  const sqrtPriceUpperX96 = TickMath.getSqrtRatioAtTick(tickUpper);

  let amount0 = 0n;
  let amount1 = 0n;

  // Scenario 1: Price is *above* the range (Range is 100% Token1)
  if (currentSqrtPriceX96 >= sqrtPriceUpperX96) {
    amount1 = (liquidity * (sqrtPriceUpperX96 - sqrtPriceLowerX96)) / Q96;
  }
  // Scenario 2: Price is *below* the range (Range is 100% Token0)
  else if (currentSqrtPriceX96 < sqrtPriceLowerX96) {
    const numerator = liquidity * (sqrtPriceUpperX96 - sqrtPriceLowerX96);
    const denominator = (sqrtPriceLowerX96 * sqrtPriceUpperX96) / Q96;
    amount0 = numerator / denominator;
  }
  // Scenario 3: Price is *inside* the range (Active)
  else {
    // Token0 (Price -> Upper)
    const num0 = liquidity * (sqrtPriceUpperX96 - currentSqrtPriceX96);
    const den0 = (currentSqrtPriceX96 * sqrtPriceUpperX96) / Q96;
    amount0 = num0 / den0;

    // Token1 (Lower -> Price)
    amount1 = (liquidity * (currentSqrtPriceX96 - sqrtPriceLowerX96)) / Q96;
  }

  return { amount0, amount1 };
}

// --- Main Calculation Function ---

/**
 * Calculates the total current amount of token0 and token1 in the entire pool
 * by "walking" the initialized tick list.
 */
export function calculateTotalPoolLiquidity(poolState: PoolState): {
  totalAmount0: bigint;
  totalAmount1: bigint;
} {
  const currentSqrtPriceX96 = poolState.slot0.sqrtPriceX96;

  // 1. Get all initialized ticks and sort them numerically
  const sortedTickIndexes = Object.keys(poolState.ticks)
    .map(BigInt)
    .sort((a, b) => (a - b > 0n ? 1 : -1));

  let totalAmount0 = 0n;
  let totalAmount1 = 0n;
  let runningLiquidity = 0n;
  let lastTickProcessed: bigint = BigInt(TickMath.MIN_TICK);

  // 2. Iterate through each tick slice
  for (const tickIndex of sortedTickIndexes) {
    if (tickIndex < lastTickProcessed) continue; // Should not happen if sorted, but good check

    const tickLower = lastTickProcessed;
    const tickUpper = tickIndex;

    // Calculate amounts for the slice *before* this tick
    const { amount0, amount1 } = getAmountsForLiquidity(
      currentSqrtPriceX96,
      tickLower,
      tickUpper,
      runningLiquidity,
    );

    totalAmount0 += amount0;
    totalAmount1 += amount1;

    // 3. "Cross" the tick: update runningLiquidity for the *next* slice
    const tickInfo = poolState.ticks[String(tickIndex)];
    runningLiquidity += tickInfo.liquidityNet;

    lastTickProcessed = tickIndex;
  }

  // 4. Calculate amounts for the final slice (from the last tick to MAX_TICK)
  const { amount0, amount1 } = getAmountsForLiquidity(
    currentSqrtPriceX96,
    lastTickProcessed,
    BigInt(TickMath.MAX_TICK),
    runningLiquidity,
  );

  totalAmount0 += amount0;
  totalAmount1 += amount1;

  return { totalAmount0, totalAmount1 };
}

// const { totalAmount0, totalAmount1 } =
//   calculateTotalPoolLiquidity(MOCK_POOL_STATE);
