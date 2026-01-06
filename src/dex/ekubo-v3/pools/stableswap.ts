import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import { EkuboContracts } from '../types';
import { EkuboPool, NamedEventHandlers, PoolKeyed, Quote } from './pool';
import { computeStep, isPriceIncreasing } from './math/swap';
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  toSqrtRatio,
} from './math/tick';
import { parseSwappedEvent, PoolKey, StableswapPoolTypeConfig } from './utils';
import { amount0Delta, amount1Delta } from './math/delta';
import { initializedTicksCrossedGasCosts } from './base';
import { FullRangePoolState } from './full-range';

const GAS_COST_OF_ONE_STABLESWAP_SWAP = 16_818;

export class StableswapPool extends EkuboPool<
  StableswapPoolTypeConfig,
  FullRangePoolState.Object
> {
  public readonly lowerPrice;
  public readonly upperPrice;

  private readonly quoteDataFetcher;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    key: PoolKey<StableswapPoolTypeConfig>,
  ) {
    const {
      contract: { address },
      interface: iface,
      quoteDataFetcher,
    } = contracts.core;

    super(
      parentName,
      dexHelper,
      logger,
      key,
      {
        [address]: new NamedEventHandlers(iface, {
          PositionUpdated: (args, oldState) => {
            if (key.numId !== BigInt(args.poolId)) {
              return null;
            }

            return FullRangePoolState.fromPositionUpdatedEvent(
              oldState,
              args.liquidityDelta.toBigInt(),
            );
          },
        }),
      },
      {
        [address]: data => {
          const ev = parseSwappedEvent(data);

          if (key.numId !== ev.poolId) {
            return null;
          }

          return FullRangePoolState.fromSwappedEvent(ev);
        },
      },
    );

    this.quoteDataFetcher = quoteDataFetcher;

    const bounds = computeStableswapBounds(key.config.poolTypeConfig);
    this.lowerPrice = bounds.lowerPrice;
    this.upperPrice = bounds.upperPrice;
  }

  public async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<FullRangePoolState.Object>> {
    const data = await this.quoteDataFetcher.getQuoteData(
      [this.key.toAbi()],
      0,
      {
        blockTag: blockNumber,
      },
    );
    return FullRangePoolState.fromQuoter(data[0]);
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<FullRangePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return this.quoteStableswap(amount, isToken1, state, sqrtRatioLimit);
  }

  public quoteStableswap(
    this: PoolKeyed<StableswapPoolTypeConfig> & StableswapBounds,
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<FullRangePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote<FullRangePoolState.Object> {
    const isIncreasing = isPriceIncreasing(amount, isToken1);

    let { sqrtRatio, liquidity } = state;

    sqrtRatioLimit ??= isIncreasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;

    let calculatedAmount = 0n;
    let initializedTicksCrossed = 0;
    let amountRemaining = amount;

    while (amountRemaining !== 0n && sqrtRatio !== sqrtRatioLimit) {
      let stepLiquidity = liquidity;
      const inRange =
        sqrtRatio < this.upperPrice && sqrtRatio > this.lowerPrice;

      let nextTickSqrtRatio = null;
      if (inRange) {
        nextTickSqrtRatio = isIncreasing ? this.upperPrice : this.lowerPrice;
      } else {
        stepLiquidity = 0n;

        if (sqrtRatio <= this.lowerPrice) {
          if (isIncreasing) {
            nextTickSqrtRatio = this.lowerPrice;
          }
        } else {
          if (!isIncreasing) {
            nextTickSqrtRatio = this.upperPrice;
          }
        }
      }

      const stepSqrtRatioLimit =
        nextTickSqrtRatio === null ||
        nextTickSqrtRatio < sqrtRatioLimit !== isIncreasing
          ? sqrtRatioLimit
          : nextTickSqrtRatio;

      const step = computeStep({
        fee: this.key.config.fee,
        sqrtRatio,
        liquidity: stepLiquidity,
        isToken1,
        sqrtRatioLimit: stepSqrtRatioLimit,
        amount: amountRemaining,
      });

      amountRemaining -= step.consumedAmount;
      calculatedAmount += step.calculatedAmount;
      sqrtRatio = step.sqrtRatioNext;

      if (sqrtRatio === nextTickSqrtRatio) {
        initializedTicksCrossed++;
      }
    }

    return {
      consumedAmount: amount - amountRemaining,
      calculatedAmount,
      gasConsumed:
        GAS_COST_OF_ONE_STABLESWAP_SWAP +
        initializedTicksCrossedGasCosts(initializedTicksCrossed),
      skipAhead: 0,
      stateAfter: {
        sqrtRatio,
        liquidity,
      },
    };
  }

  protected _computeTvl(state: FullRangePoolState.Object): [bigint, bigint] {
    const { sqrtRatio, liquidity } = state;

    let [amount0, amount1] = [0n, 0n];

    if (sqrtRatio < this.upperPrice) {
      amount0 = amount0Delta(sqrtRatio, this.upperPrice, liquidity, false);
    }
    if (sqrtRatio > this.lowerPrice) {
      amount1 = amount1Delta(this.lowerPrice, sqrtRatio, liquidity, false);
    }

    return [amount0, amount1];
  }
}

export interface StableswapBounds {
  lowerPrice: bigint;
  upperPrice: bigint;
}

export function computeStableswapBounds(
  config: StableswapPoolTypeConfig,
): StableswapBounds {
  const { centerTick, amplificationFactor } = config;

  const liquidityWidth = MAX_TICK >> amplificationFactor;
  const [lowerTick, upperTick] = [
    centerTick - liquidityWidth,
    centerTick + liquidityWidth,
  ];

  return {
    lowerPrice: lowerTick > MIN_TICK ? toSqrtRatio(lowerTick) : MIN_SQRT_RATIO,
    upperPrice: upperTick < MAX_TICK ? toSqrtRatio(upperTick) : MAX_SQRT_RATIO,
  };
}
