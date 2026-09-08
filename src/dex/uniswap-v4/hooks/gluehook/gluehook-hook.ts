import { IDexHelper } from '../../../../dex-helper';
import { GlueHookConfig } from './config';
import { Network } from '../../../../constants';
import { Logger } from '../../../../types';
import { PoolKey } from '../../types';
import {
  SwapParams,
  BalanceDelta,
  HooksPermissions,
  IBaseHook,
} from '../types';

/**
 * GlueHook (https://gluehook.trade) — a free, keyless, general-purpose hook that gives a
 * pool a permissionless buyback pot (it buys after buys and can absorb sells) plus a
 * self-compounding LP position owned by the hook itself.
 *
 * Quoting is a pure passthrough — the hook NEVER changes the swapper's amounts:
 *  - Pump executes after the swap, spending the pot's own balance;
 *  - Shield absorbs a sell while paying the seller the pool's EXACT output
 *    (fee and tick impact included), so the quoted output is identical either way;
 *  - auto-harvest / compound only moves the hook's own LP fees.
 *
 * Every hook action on-chain is wrapped in try/catch — a swap can never revert on hook
 * state or settings. Standard V4 tick math therefore prices GlueHook pools exactly;
 * `afterSwap` below returns the unmodified output.
 *
 * Deployed at the same address on every chain (CREATE from a nonce-0 deployer);
 * verified everywhere. Source: https://github.com/glue-finance/GlueHook
 */
export class GlueHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
  ) {
    this.address = GlueHookConfig[network].hookAddress.toLowerCase();
  }

  registerPool(_poolId: string, _poolKey: PoolKey) {
    // stateless for quoting purposes — nothing to track per pool
  }

  async initialize(_blockNumber: number) {
    // no off-chain state needed: amounts are vanilla-V4-exact by construction
  }

  getHookPermissions(): HooksPermissions {
    // mirrors the on-chain flag bitmask 0x20C8
    return {
      beforeInitialize: true,
      afterInitialize: false,
      beforeAddLiquidity: false,
      afterAddLiquidity: false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity: false,
      beforeSwap: true,
      afterSwap: true,
      beforeDonate: false,
      afterDonate: false,
      beforeSwapReturnDelta: true,
      afterSwapReturnDelta: false,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false,
    };
  }

  afterSwap(
    _sender: string,
    _key: PoolKey,
    params: SwapParams,
    delta: BalanceDelta,
    _hookData: string,
  ): bigint {
    // Pure passthrough: return the exact amount the pool's math produced.
    const isExactInput = BigInt(params.amountSpecified) < 0n;
    if (isExactInput) {
      // amount the user receives
      return params.zeroForOne ? delta.amount1 : delta.amount0;
    }
    // amount the user pays
    return params.zeroForOne ? -delta.amount0 : -delta.amount1;
  }
}
