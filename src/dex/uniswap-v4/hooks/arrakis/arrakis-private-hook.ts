import { IDexHelper } from '../../../../dex-helper';
import { ArrakisPrivateHookConfig } from './config';
import { Network, NULL_ADDRESS } from '../../../../constants';
import { Logger } from '../../../../types';
import { PoolKey } from '../../types';
import {
  SwapParams,
  BeforeSwapDelta,
  HooksPermissions,
  IBaseHook,
} from '../types';
import { toId } from '../../utils';
import { LPFeeLibrary } from '../../contract-math/LPFeeLibrary';
import { ArrakisFeeHelper } from './arrakis-fee-helper';

const BEFORE_SWAP_SELECTOR = '0x575e24b4'; // beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)

/**
 * ArrakisPrivateHook is a dynamic fee hook used by Arrakis private vaults.
 * The vault executor sets a per-pool directional LP fee (zeroForOneFee /
 * oneForZeroFee) via `setFees`. On swaps `beforeSwap` overrides the pool's
 * LP fee with the configured value and does not modify swap amounts.
 * Swaps revert on-chain (ModuleNotSet) until fees are configured for a pool.
 */
export class ArrakisPrivateHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;
  readonly feeHelper: ArrakisFeeHelper;

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
  ) {
    this.address = ArrakisPrivateHookConfig[network].hookAddress.toLowerCase();

    this.feeHelper = new ArrakisFeeHelper(
      this.name,
      network,
      dexHelper,
      logger,
    );
  }

  registerPool(poolId: string, _poolKey: PoolKey) {
    this.feeHelper.addPoolId(poolId.toLowerCase());
  }

  async initialize(blockNumber: number) {
    if (!this.feeHelper.isInitialized) {
      await this.feeHelper.initialize(blockNumber);
    }
  }

  getHookPermissions(): HooksPermissions {
    return {
      beforeInitialize: false,
      afterInitialize: false,
      beforeAddLiquidity: true,
      afterAddLiquidity: false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity: false,
      beforeSwap: true,
      afterSwap: false,
      beforeDonate: false,
      afterDonate: false,
      beforeSwapReturnDelta: false,
      afterSwapReturnDelta: false,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false,
    };
  }

  beforeSwap(
    _sender: string,
    key: PoolKey,
    params: SwapParams,
    _hookData: string,
  ): [string, BeforeSwapDelta, number] {
    const poolId = toId(key).toLowerCase();

    const state = this.feeHelper.getStaleState();
    if (!state) {
      throw new Error(
        `${this.name}: fees state is not available for pool ${poolId}`,
      );
    }

    const feesData = state.poolIdToFeesData[poolId];
    if (!feesData || feesData.module === NULL_ADDRESS) {
      // mirrors on-chain ModuleNotSet revert: such pools are not swappable
      throw new Error(`${this.name}: fees are not set for pool ${poolId}`);
    }

    const fee = params.zeroForOne
      ? feesData.zeroForOneFee
      : feesData.oneForZeroFee;

    const lpFeeOverride = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;

    return [
      BEFORE_SWAP_SELECTOR,
      { amount0: 0n, amount1: 0n },
      Number(lpFeeOverride),
    ];
  }
}
