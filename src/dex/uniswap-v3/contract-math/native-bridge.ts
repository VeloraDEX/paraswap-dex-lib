import { DeepReadonly } from 'ts-essentials';
import { PoolState } from '../types';
import { NumberAsString } from '@paraswap/core';
import {
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_TO_USE_BY_CHAIN,
  TICK_BITMAP_BUFFER_BY_CHAIN,
} from '../constants';

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
 * Convert a PoolState to the init format expected by the Rust addon.
 */
function toRustInit(
  state: DeepReadonly<PoolState>,
  variant: string = 'uniswap_v3',
  bitmapRangeOverride?: number,
) {
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

  const observations = Object.entries(
    state.observations as Record<
      number,
      {
        blockTimestamp: bigint;
        tickCumulative: bigint;
        secondsPerLiquidityCumulativeX128: bigint;
        initialized: boolean;
      }
    >,
  ).map(([key, obs]) => ({
    key: Number(key),
    blockTimestamp: obs.blockTimestamp,
    tickCumulative: obs.tickCumulative,
    secondsPerLiquidityCumulativeX128: obs.secondsPerLiquidityCumulativeX128,
    initialized: obs.initialized,
  }));

  const bitmapUse = Number(
    TICK_BITMAP_TO_USE_BY_CHAIN[state.networkId] ?? TICK_BITMAP_TO_USE,
  );
  const bitmapBuffer = Number(
    TICK_BITMAP_BUFFER_BY_CHAIN[state.networkId] ?? TICK_BITMAP_BUFFER,
  );

  return {
    variant,
    bitmapRange: bitmapRangeOverride ?? bitmapBuffer + bitmapUse,
    blockTimestamp: state.blockTimestamp,
    tickSpacing: state.tickSpacing,
    fee: state.fee,
    sqrtPriceX96: state.slot0.sqrtPriceX96,
    tick: state.slot0.tick,
    observationIndex: state.slot0.observationIndex,
    observationCardinality: state.slot0.observationCardinality,
    observationCardinalityNext: state.slot0.observationCardinalityNext,
    feeProtocol: state.slot0.feeProtocol,
    liquidity: state.liquidity,
    maxLiquidityPerTick: state.maxLiquidityPerTick,
    startTickBitmap: state.startTickBitmap,
    lowestKnownTick: state.lowestKnownTick,
    highestKnownTick: state.highestKnownTick,
    tickBitmap,
    ticks,
    observations,
  };
}

/**
 * Create a RustPoolHandle from a PoolState.
 * Returns null if the native addon is not available.
 */
export function createRustHandle(
  state: DeepReadonly<PoolState>,
  variant: string = 'uniswap_v3',
  bitmapRange?: number,
): RustPoolHandleType | null {
  if (!nativeAddonAvailable) return null;
  try {
    return nativeAddon.RustPoolHandle.create(
      toRustInit(state, variant, bitmapRange),
    );
  } catch {
    return null;
  }
}

// ---- Pool Registry for batch parallel queries ----

export type RegistryQueryResult = {
  key: string;
  outputs: bigint[];
  tickCounts: number[];
};

export type RustPoolRegistryType = {
  setPool(key: string, init: ReturnType<typeof toRustInit>): void;
  removePool(key: string): void;
  queryMany(
    keys: string[],
    amounts: bigint[],
    zeroForOne: boolean,
    side: number,
  ): RegistryQueryResult[];
  poolCount(): number;
};

export function createRegistry(): RustPoolRegistryType | null {
  if (!nativeAddonAvailable) return null;
  try {
    return new nativeAddon.RustPoolRegistry();
  } catch {
    return null;
  }
}

export function registrySetPool(
  registry: RustPoolRegistryType,
  key: string,
  state: DeepReadonly<PoolState>,
  variant: string = 'uniswap_v3',
  bitmapRange?: number,
): void {
  try {
    registry.setPool(key, toRustInit(state, variant, bitmapRange));
  } catch {
    // silently skip — pool will use JS fallback
  }
}
