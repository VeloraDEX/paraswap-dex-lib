import { NULL_ADDRESS } from '../../../constants';
import { DexParams, PoolState, SwapParams } from '../types';

export function _hookletBeforeSwap(
  state: PoolState,
  params: SwapParams,
  dexParams: DexParams,
): {
  success: boolean;
  feeOverridden: boolean;
  fee: bigint;
  priceOverridden: boolean;
  sqrtPriceX96: bigint;
} {
  if (state.hooklet === NULL_ADDRESS) {
    return {
      success: true,
      feeOverridden: false,
      fee: 0n,
      priceOverridden: false,
      sqrtPriceX96: 0n,
    };
  }

  const map = dexParams.hooklets ?? {};
  const module = map[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.beforeSwap(state, params);
}

export function _hookletBeforeSwapView(
  state: PoolState,
  params: SwapParams,
  dexParams: DexParams,
): {
  success: boolean;
  feeOverridden: boolean;
  fee: bigint;
  priceOverridden: boolean;
  sqrtPriceX96: bigint;
} {
  if (state.hooklet === NULL_ADDRESS) {
    return {
      success: true,
      feeOverridden: false,
      fee: 0n,
      priceOverridden: false,
      sqrtPriceX96: 0n,
    };
  }

  const map = dexParams.hooklets ?? {};
  const module = map[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.beforeSwapView(state, params);
}

export function _hookletAfterSwap(
  state: PoolState,
  dexParams: DexParams,
): {
  success: boolean;
} {
  if (state.hooklet === NULL_ADDRESS) {
    return { success: true };
  }

  const map = dexParams.hooklets ?? {};
  const module = map[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.afterSwap();
}

export function _hookletAfterSwapView(
  state: PoolState,
  dexParams: DexParams,
): {
  success: boolean;
} {
  if (state.hooklet === NULL_ADDRESS) {
    return { success: true };
  }

  const map = dexParams.hooklets ?? {};
  const module = map[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.afterSwapView();
}
