import { IDexHelper } from '../../../../dex-helper';
import { Network } from '../../../../constants';
import { Logger } from '../../../../types';
import { PoolKey } from '../../types';
import {
  BeforeSwapDelta,
  HooksPermissions,
  IBaseHook,
  SwapParams,
} from '../types';
import { _require } from '../../../../utils';
import { SellOnlyHookConfig } from './config';

const BEFORE_SWAP_SELECTOR = '0x575e24b4';

// SellOnly lets anyone sell currency0 into the pool's liquidity; every other
// swap reverts on chain unless the pool's owner sends it. It takes no fee and
// returns no delta, so a permitted swap prices exactly as a hookless pool.
export class SellOnlyHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
  ) {
    this.address = SellOnlyHookConfig[network].hookAddress.toLowerCase();
  }

  registerPool(_poolId: string, _poolKey: PoolKey) {}

  async initialize(_blockNumber: number) {}

  getHookPermissions(): HooksPermissions {
    return {
      beforeInitialize: true,
      afterInitialize: false,
      beforeAddLiquidity: true,
      afterAddLiquidity: false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity: false,
      beforeSwap: true,
      afterSwap: false,
      beforeDonate: true,
      afterDonate: false,
      beforeSwapReturnDelta: false,
      afterSwapReturnDelta: false,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false,
    };
  }

  beforeSwap(
    _sender: string,
    _key: PoolKey,
    params: SwapParams,
    _hookData: string,
  ): [string, BeforeSwapDelta, number] {
    _require(
      params.zeroForOne,
      'SellOnly: only currency0 can be sold into the pool',
      { zeroForOne: params.zeroForOne },
      'params.zeroForOne',
    );

    return [BEFORE_SWAP_SELECTOR, { amount0: 0n, amount1: 0n }, 0];
  }
}
