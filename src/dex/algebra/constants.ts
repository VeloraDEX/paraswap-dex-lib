import { Network } from '../../constants';

/// THIS FILE CONTAINS OVERRIDES OF UniswapV3's constant file

export const TICK_BITMAP_TO_USE = 400n;

export const TICK_BITMAP_BUFFER = 800n;

export const TICK_BITMAP_TO_USE_BY_CHAIN: Record<number, bigint> = {};

export const TICK_BITMAP_BUFFER_BY_CHAIN: Record<number, bigint> = {};

export const MAX_PRICING_COMPUTATION_STEPS_ALLOWED = 4096;
