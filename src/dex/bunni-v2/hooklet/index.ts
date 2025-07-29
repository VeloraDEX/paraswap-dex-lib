import { NULL_ADDRESS } from '../../../constants';
import { PoolState, SwapParams } from '../types';
import { FeeOverrideHooklet } from './FeeOverrideHooklet';

const Hooklets: Record<string, any> = {
  ['0x0000e819b8a536cf8e5d70b9c49256911033000c'.toLowerCase()]:
    FeeOverrideHooklet, // 1.0.0
  ['0x00eCE5a72612258f20eB24573C544f9dD8c5000C'.toLowerCase()]:
    FeeOverrideHooklet, // 1.0.1
};

export function _hookletBeforeSwap(
  state: PoolState,
  params: SwapParams,
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

  const module = Hooklets[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.beforeSwap(state, params);
}

export function _hookletBeforeSwapView(
  state: PoolState,
  params: SwapParams,
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

  const module = Hooklets[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.beforeSwapView(state, params);
}

export function _hookletAfterSwap(state: PoolState): {
  success: boolean;
} {
  if (state.hooklet === NULL_ADDRESS) {
    return { success: true };
  }

  const module = Hooklets[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.afterSwap();
}

export function _hookletAfterSwapView(state: PoolState): {
  success: boolean;
} {
  if (state.hooklet === NULL_ADDRESS) {
    return { success: true };
  }

  const module = Hooklets[state.hooklet.toLowerCase()];

  if (!module) {
    throw new Error(`Hooklet ${state.hooklet} not yet supported`);
  }

  return module.afterSwapView();
}
