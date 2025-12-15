import { DeepReadonly } from 'ts-essentials';
import { PoolKeyed, Quote } from './pool';
import { BasePool, BasePoolState } from './base';
import { approximateSqrtRatioToTick } from './math/tick';
import { BI_MAX_UINT64 } from '../../../bigint-constants';
import { amountBeforeFee, computeFee } from './math/swap';
import { ConcentratedPoolTypeConfig } from './utils';

const EXTRA_BASE_GAS_COST_OF_ONE_MEV_CAPTURE_SWAP = 33_500;

export class MevCapturePool extends BasePool {
  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<BasePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return this.quoteMevCapture(amount, isToken1, state, sqrtRatioLimit);
  }

  public quoteMevCapture(
    this: PoolKeyed<ConcentratedPoolTypeConfig>,
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<BasePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote<
    Pick<BasePoolState.Object, 'activeTickIndex' | 'sqrtRatio' | 'liquidity'>
  > {
    const quote = BasePool.prototype.quoteBase.call(
      this,
      amount,
      isToken1,
      state,
      sqrtRatioLimit,
    );

    const tickAfterSwap = approximateSqrtRatioToTick(
      quote.stateAfter.sqrtRatio,
    );
    const poolConfig = this.key.config;
    const approximateFeeMultiplier =
      (Math.abs(tickAfterSwap - state.activeTick) + 1) /
      poolConfig.poolTypeConfig.tickSpacing;

    let fixedPointAdditionalFee = BigInt(
      Math.round(approximateFeeMultiplier * Number(poolConfig.fee)),
    );

    if (fixedPointAdditionalFee > BI_MAX_UINT64) {
      fixedPointAdditionalFee = BI_MAX_UINT64;
    }

    let calculatedAmount = quote.calculatedAmount;

    if (amount >= 0n) {
      // Exact input, remove the additional fee from the output
      calculatedAmount -= computeFee(calculatedAmount, fixedPointAdditionalFee);
    } else {
      const inputAmountFee = computeFee(calculatedAmount, poolConfig.fee);
      const inputAmount = calculatedAmount - inputAmountFee;

      const bf = amountBeforeFee(inputAmount, fixedPointAdditionalFee);
      const fee = bf - inputAmount;
      calculatedAmount += fee;
    }

    quote.gasConsumed += EXTRA_BASE_GAS_COST_OF_ONE_MEV_CAPTURE_SWAP;
    quote.calculatedAmount = calculatedAmount;

    return quote;
  }
}
