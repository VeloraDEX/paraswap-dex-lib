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
import { SellOnlyHookConfig, SellOnlyParams } from './config';

const BEFORE_SWAP_SELECTOR = '0x575e24b4';

// Any other swap reverts on chain unless the pool's owner sends it.
export class SellOnlyHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;
  readonly sellsCurrency0: boolean;

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
    config: SellOnlyParams = SellOnlyHookConfig[network],
  ) {
    this.address = config.hookAddress.toLowerCase();
    this.sellsCurrency0 = config.sellsCurrency0;
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
      params.zeroForOne === this.sellsCurrency0,
      `${this.name}: only ${
        this.sellsCurrency0 ? 'currency0' : 'currency1'
      } can be sold into the pool`,
      { zeroForOne: params.zeroForOne },
      `params.zeroForOne === ${this.sellsCurrency0}`,
    );

    return [BEFORE_SWAP_SELECTOR, { amount0: 0n, amount1: 0n }, 0];
  }
}
