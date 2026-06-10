import { DeepReadonly } from 'ts-essentials';
import { Pool, PoolState } from '../types';
import { NumberAsString } from '@paraswap/core';
import {
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_TO_USE_BY_CHAIN,
  TICK_BITMAP_BUFFER_BY_CHAIN,
} from '../constants';
import { TickBitMap } from './TickBitMap';

// Try to load the native Rust addon
let nativeAddon: any = null;
try {
  nativeAddon = require('../../../../native/index.js');
} catch {
  // Native addon not available — JS fallback will be used
}

export const nativeAddonAvailable = nativeAddon !== null;

export type V4RegistryQueryResult = {
  key: string;
  outputs: bigint[];
};

export type RustV4RegistryType = {
  setPool(key: string, init: ReturnType<typeof toV4RustInit>): void;
  removePool(key: string): void;
  queryMany(
    keys: string[],
    amounts: bigint[],
    zeroForOne: boolean,
    side: number,
  ): V4RegistryQueryResult[];
  poolCount(): number;
};

/**
 * Convert a V4 PoolState + Pool to the init format expected by
 * the Rust RustV4PoolRegistry addon.
 */
export function toV4RustInit(
  state: DeepReadonly<PoolState>,
  pool: DeepReadonly<Pool>,
  networkId?: number,
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

  const tickSpacing = BigInt(pool.key.tickSpacing);
  const compressed = TickBitMap.compress(state.slot0.tick, tickSpacing);
  const startTickBitmap = TickBitMap.position(compressed)[0];

  const bitmapUse = Number(
    networkId !== undefined
      ? TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE
      : TICK_BITMAP_TO_USE,
  );
  const bitmapBuffer = Number(
    networkId !== undefined
      ? TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER
      : TICK_BITMAP_BUFFER,
  );

  return {
    sqrtPriceX96: state.slot0.sqrtPriceX96,
    tick: state.slot0.tick,
    protocolFee: BigInt(state.slot0.protocolFee),
    lpFee: BigInt(state.slot0.lpFee),
    liquidity: state.liquidity,
    tickSpacing,
    feeGrowthGlobal0X128: state.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: state.feeGrowthGlobal1X128,
    bitmapRange: bitmapBuffer + bitmapUse,
    startTickBitmap,
    tickBitmap,
    ticks,
  };
}

export function createV4Registry(): RustV4RegistryType | null {
  if (!nativeAddonAvailable) return null;
  try {
    return new nativeAddon.RustV4PoolRegistry();
  } catch {
    return null;
  }
}

export function v4RegistrySetPool(
  registry: RustV4RegistryType,
  key: string,
  state: DeepReadonly<PoolState>,
  pool: DeepReadonly<Pool>,
  networkId?: number,
): void {
  try {
    registry.setPool(key, toV4RustInit(state, pool, networkId));
  } catch {
    // silently skip — pool will use JS fallback
  }
}
