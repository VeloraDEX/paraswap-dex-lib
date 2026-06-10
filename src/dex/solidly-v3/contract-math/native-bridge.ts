import { DeepReadonly } from 'ts-essentials';
import { PoolState } from '../types';
import { NumberAsString } from '@paraswap/core';
import { RustPoolRegistryType } from '../../uniswap-v3/contract-math/native-bridge';

export { RustPoolRegistryType };

// Try to load the native Rust addon
let nativeAddon: any = null;
try {
  nativeAddon = require('../../../../native/index.js');
} catch {
  // Native addon not available — JS fallback will be used
}

export const nativeAddonAvailable = nativeAddon !== null;

// Allow forcing JS backend via env var
export const useNativeMath =
  nativeAddonAvailable && process.env.PARASWAP_V3_MATH !== 'js';

export type RustPoolHandleType = {
  queryOutputs(
    amounts: bigint[],
    zeroForOne: boolean,
    side: number,
  ): { outputs: bigint[]; tickCounts: number[] };
};

/**
 * Convert a Solidly V3 PoolState to the init format expected by the Rust addon.
 * Solidly V3 differs from Uniswap V3:
 * - fee is in slot0 (not a top-level field)
 * - no feeProtocol in slot0
 * - no oracle observations
 */
function toRustInit(state: DeepReadonly<PoolState>) {
  const tickBitmap = Object.entries(
    state.tickBitmap as Record<NumberAsString, bigint>,
  ).map(([key, value]) => ({
    key: Number(key),
    value,
  }));

  const ticks = Object.entries(
    state.ticks as Record<
      NumberAsString,
      { liquidityGross: bigint; liquidityNet: bigint }
    >,
  ).map(([key, info]) => ({
    key: Number(key),
    liquidityGross: info.liquidityGross,
    liquidityNet: info.liquidityNet,
  }));

  return {
    variant: 'solidly_v3',
    bitmapRange: 12, // TICK_BITMAP_BUFFER(8) + TICK_BITMAP_TO_USE(4)
    blockTimestamp: state.blockTimestamp,
    tickSpacing: state.tickSpacing,
    fee: state.slot0.fee,
    sqrtPriceX96: state.slot0.sqrtPriceX96,
    tick: state.slot0.tick,
    observationIndex: 0,
    observationCardinality: 0,
    observationCardinalityNext: 0,
    feeProtocol: 0n,
    liquidity: state.liquidity,
    maxLiquidityPerTick: state.maxLiquidityPerTick,
    startTickBitmap: state.startTickBitmap,
    lowestKnownTick: state.lowestKnownTick,
    highestKnownTick: state.highestKnownTick,
    tickBitmap,
    ticks,
    observations: [],
  };
}

/**
 * Create a RustPoolHandle from a Solidly V3 PoolState.
 * Returns null if the native addon is not available.
 */
export function createSolidlyRustHandle(
  state: DeepReadonly<PoolState>,
): RustPoolHandleType | null {
  if (!nativeAddonAvailable) return null;
  try {
    return nativeAddon.RustPoolHandle.create(toRustInit(state));
  } catch {
    return null;
  }
}

/**
 * Create a RustPoolRegistry for batch parallel queries.
 * Returns null if the native addon is not available.
 */
export function createSolidlyRegistry(): RustPoolRegistryType | null {
  if (!nativeAddonAvailable) return null;
  try {
    return new nativeAddon.RustPoolRegistry();
  } catch {
    return null;
  }
}

/**
 * Register a Solidly V3 pool in the registry using Solidly-specific state mapping.
 */
export function solidlyRegistrySetPool(
  registry: RustPoolRegistryType,
  key: string,
  state: DeepReadonly<PoolState>,
): void {
  try {
    registry.setPool(key, toRustInit(state));
  } catch {
    // silently skip — pool will use JS fallback
  }
}
