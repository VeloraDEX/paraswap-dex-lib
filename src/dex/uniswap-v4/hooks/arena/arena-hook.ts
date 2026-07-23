import { IDexHelper } from '../../../../dex-helper';
import { ArenaHookConfig } from './config';
import { Network } from '../../../../constants';
import { Logger } from '../../../../types';
import { PoolKey } from '../../types';
import {
  SwapParams,
  BalanceDelta,
  HooksPermissions,
  IBaseHook,
} from '../types';
import { toId } from '../../utils';
import { _require } from '../../../../utils';
import { ArenaFeeHelper } from './arena-fee-helper';

const MAX_HOOK_FEE = 1_000_000n; // 100%
const UINT128_MAX = (1n << 128n) - 1n;
const INT128_MAX = (1n << 127n) - 1n;

export class ArenaHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;
  readonly arenaFeeHelper: ArenaFeeHelper;

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
    readonly feeHelperAddress = ArenaHookConfig[
      network
    ].feeHelperAddress.toLowerCase(),
  ) {
    this.address = ArenaHookConfig[network].hookAddress.toLowerCase();

    this.arenaFeeHelper = new ArenaFeeHelper(
      this.name,
      network,
      dexHelper,
      logger,
    );
  }

  registerPool(poolId: string, _poolKey: PoolKey) {
    this.arenaFeeHelper.addPoolId(poolId.toLowerCase());
  }

  async initialize(blockNumber: number) {
    if (!this.arenaFeeHelper.isInitialized) {
      await this.arenaFeeHelper.initialize(blockNumber);
    }
  }

  getHookPermissions(): HooksPermissions {
    return {
      beforeInitialize: true,
      afterInitialize: false,
      beforeAddLiquidity: false,
      afterAddLiquidity: false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity: false,
      beforeSwap: false,
      afterSwap: true,
      beforeDonate: false,
      afterDonate: false,
      beforeSwapReturnDelta: false,
      afterSwapReturnDelta: true,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false,
    };
  }

  afterSwap(
    _sender: string,
    key: PoolKey,
    params: SwapParams,
    delta: BalanceDelta,
    _hookData: string,
  ): bigint {
    const { amountSpecified, zeroForOne } = params;

    const isExactInput = BigInt(amountSpecified) < 0n;

    // Determine the unspecified (output) delta based on swap direction and type:
    // - ExactInput + zeroForOne: input is token0, output is token1 (amount1)
    // - ExactInput + oneForZero: input is token1, output is token0 (amount0)
    // - ExactOutput + zeroForOne: output is token1, input is token0 (amount0 is unspecified)
    // - ExactOutput + oneForZero: output is token0, input is token1 (amount1 is unspecified)
    const outputIsToken1 = isExactInput === zeroForOne;
    const unspecifiedDelta = outputIsToken1 ? delta.amount1 : delta.amount0;

    if (unspecifiedDelta === 0n) {
      return 0n;
    }

    const output = unspecifiedDelta < 0n ? -unspecifiedDelta : unspecifiedDelta;

    _require(
      output <= UINT128_MAX,
      'Unspecified output exceeds uint128',
      { output },
      'output <= UINT128_MAX',
    );

    const totalFeePpm = this.getTotalFeePpm(toId(key));

    if (totalFeePpm === null || totalFeePpm === 0n) {
      return 0n;
    }

    _require(
      totalFeePpm <= MAX_HOOK_FEE,
      'Hook fee too large',
      { totalFeePpm },
      'totalFeePpm <= MAX_HOOK_FEE',
    );

    const feeAmount = (output * totalFeePpm) / MAX_HOOK_FEE;

    _require(
      feeAmount <= INT128_MAX,
      'Hook fee exceeds int128',
      { feeAmount },
      'feeAmount <= INT128_MAX',
    );

    // For exact input: user receives output minus fee
    // For exact output: user must provide more input to cover fee
    const netOutput = isExactInput ? output - feeAmount : output + feeAmount;

    return netOutput;
  }

  private getTotalFeePpm(poolId: string): bigint | null {
    if (!this.arenaFeeHelper?.isInitialized) {
      return null;
    }

    const state = this.arenaFeeHelper.getStaleState();
    if (!state) {
      return null;
    }

    const poolFee = state.poolIdToTotalFeePpm[poolId] ?? 0n;

    return poolFee + BigInt(state.protocolFeePpm);
  }
}
