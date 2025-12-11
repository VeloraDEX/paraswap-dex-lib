import { PoolKey } from '../types';
import { IDexHelper } from '../../../dex-helper';
import { Network } from '../../../constants';
import { Logger } from '../../../types';

export type HookConfig<HookParams> = {
  [network: number]: HookParams;
};

export interface BalanceDelta {
  amount0: bigint; // int128
  amount1: bigint; // int128
}

export interface BeforeSwapDelta {
  amount0: bigint; // int128
  amount1: bigint; // int128
}

export interface SwapParams {
  zeroForOne: boolean;
  amountSpecified: string; // int256
  sqrtPriceLimitX96: string; // uint160
}

export interface ModifyLiquidityParams {
  tickLower: number; // int24
  tickUpper: number; // int24
  liquidityDelta: string; // int256
  salt: string; // bytes32
}

export interface HooksPermissions {
  beforeInitialize: boolean;
  afterInitialize: boolean;
  beforeAddLiquidity: boolean;
  afterAddLiquidity: boolean;
  beforeRemoveLiquidity: boolean;
  afterRemoveLiquidity: boolean;
  beforeSwap: boolean;
  afterSwap: boolean;
  beforeDonate: boolean;
  afterDonate: boolean;
  beforeSwapReturnDelta: boolean;
  afterSwapReturnDelta: boolean;
  afterAddLiquidityReturnDelta: boolean;
  afterRemoveLiquidityReturnDelta: boolean;
}

export interface IBaseHook {
  readonly name: string;

  readonly address: string;

  getHookPermissions(): HooksPermissions;

  registerPool(poolId: string, poolKey: PoolKey): void;

  initialize(blockNumber: number): Promise<void>;

  beforeInitialize?(
    sender: string,
    key: PoolKey,
    sqrtPriceX96: string,
  ): Promise<string>; // bytes4

  afterInitialize?(
    sender: string,
    key: PoolKey,
    sqrtPriceX96: string,
    tick: number,
  ): Promise<string>; // bytes4

  beforeAddLiquidity?(
    sender: string,
    key: PoolKey,
    params: ModifyLiquidityParams,
    hookData: string,
  ): Promise<string>;

  beforeRemoveLiquidity?(
    sender: string,
    key: PoolKey,
    params: ModifyLiquidityParams,
    hookData: string,
  ): Promise<string>;

  afterAddLiquidity?(
    sender: string,
    key: PoolKey,
    params: ModifyLiquidityParams,
    delta0: BalanceDelta,
    delta1: BalanceDelta,
    hookData: string,
  ): Promise<[string, BalanceDelta]>;

  afterRemoveLiquidity?(
    sender: string,
    key: PoolKey,
    params: ModifyLiquidityParams,
    delta0: BalanceDelta,
    delta1: BalanceDelta,
    hookData: string,
  ): Promise<[string, BalanceDelta]>;

  beforeSwap?(
    sender: string,
    key: PoolKey,
    params: SwapParams,
    hookData: string,
  ): Promise<[string, BeforeSwapDelta, number]>; // bytes4, BeforeSwapDelta, uint24

  afterSwap?(
    sender: string,
    key: PoolKey,
    params: SwapParams,
    delta: BalanceDelta,
    hookData: string,
  ): Promise<bigint>; // int128

  beforeDonate?(
    sender: string,
    key: PoolKey,
    amount0: string,
    amount1: string,
    hookData: string,
  ): Promise<string>;

  afterDonate?(
    sender: string,
    key: PoolKey,
    amount0: string,
    amount1: string,
    hookData: string,
  ): Promise<string>;
}

export type HookConstructor = new (
  dexHelper: IDexHelper,
  network: Network,
  logger: Logger,
) => IBaseHook;
