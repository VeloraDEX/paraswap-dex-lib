import { PoolState, SwapParams } from '../types';

export abstract class FeeOverrideHooklet {
  static beforeSwap(
    state: PoolState,
    params: SwapParams,
  ): {
    success: boolean;
    feeOverridden: boolean;
    fee: bigint;
    priceOverridden: boolean;
    sqrtPriceX96: bigint;
  } {
    return this._beforeSwap(state, params);
  }

  static beforeSwapView(
    state: PoolState,
    params: SwapParams,
  ): {
    success: boolean;
    feeOverridden: boolean;
    fee: bigint;
    priceOverridden: boolean;
    sqrtPriceX96: bigint;
  } {
    return this._beforeSwap(state, params);
  }

  static afterSwap(state: PoolState): { success: boolean } {
    return this._afterSwap(state);
  }

  static afterSwapView(state: PoolState): { success: boolean } {
    return this._afterSwap(state);
  }

  static _beforeSwap(
    state: PoolState,
    params: SwapParams,
  ): {
    success: boolean;
    feeOverridden: boolean;
    fee: bigint;
    priceOverridden: boolean;
    sqrtPriceX96: bigint;
  } {
    return {
      success: true,
      feeOverridden: params.zeroForOne
        ? state.overrideZeroToOne
        : state.overrideOneToZero,
      fee: params.zeroForOne ? state.feeZeroToOne : state.feeOneToZero,
      priceOverridden: false,
      sqrtPriceX96: 0n,
    };
  }

  static _afterSwap(state: PoolState): { success: boolean } {
    return { success: true };
  }
}
