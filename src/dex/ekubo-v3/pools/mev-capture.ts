import { Result } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Quote } from './pool';
import {
  ConcentratedPoolBase,
  ConcentratedPoolState,
  quoteConcentrated,
} from './concentrated';
import { approximateSqrtRatioToTick } from './math/tick';
import { BI_MAX_UINT64 } from '../../../bigint-constants';
import { amountBeforeFee, computeFee } from './math/swap';
import { ConcentratedPoolTypeConfig, PoolKey, SwappedEvent } from './utils';
import { BigNumber } from 'ethers';
import { hexDataSlice } from 'ethers/lib/utils';

// This assumes fees are always accumulated
const EXTRA_BASE_GAS_COST_OF_ONE_MEV_CAPTURE_SWAP = 32_258;

export class MevCapturePool extends ConcentratedPoolBase<ConcentratedPoolState.Object> {
  public override async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ConcentratedPoolState.Object>> {
    const data = await this.quoteDataFetcher.getQuoteData(
      [this.key.toAbi()],
      10,
      {
        blockTag: blockNumber,
      },
    );
    return ConcentratedPoolState.fromQuoter(data[0]);
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<ConcentratedPoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return quoteMevCapture(this.key, amount, isToken1, state, sqrtRatioLimit);
  }

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<ConcentratedPoolState.Object>,
  ): DeepReadonly<ConcentratedPoolState.Object> | null {
    const [lower, upper] = [
      BigNumber.from(hexDataSlice(args.positionId, 24, 28))
        .fromTwos(32)
        .toNumber(),
      BigNumber.from(hexDataSlice(args.positionId, 28, 32))
        .fromTwos(32)
        .toNumber(),
    ];

    return ConcentratedPoolState.fromPositionUpdatedEvent(
      oldState,
      [lower, upper],
      args.liquidityDelta.toBigInt(),
    );
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    oldState: DeepReadonly<ConcentratedPoolState.Object>,
  ): DeepReadonly<ConcentratedPoolState.Object> | null {
    return ConcentratedPoolState.fromSwappedEvent(oldState, ev);
  }
}

export function quoteMevCapture(
  key: PoolKey<ConcentratedPoolTypeConfig>,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<ConcentratedPoolState.Object>,
  sqrtRatioLimit?: bigint,
): Quote<
  Pick<
    ConcentratedPoolState.Object,
    'activeTickIndex' | 'sqrtRatio' | 'liquidity'
  >
> {
  const quote = quoteConcentrated(key, amount, isToken1, state, sqrtRatioLimit);

  const tickAfterSwap = approximateSqrtRatioToTick(quote.stateAfter.sqrtRatio);
  const poolConfig = key.config;
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
