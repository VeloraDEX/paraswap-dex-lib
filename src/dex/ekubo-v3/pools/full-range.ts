import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { Result } from '@ethersproject/abi';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import {
  BasicQuoteData,
  EkuboContracts,
  PoolInitializationState,
} from '../types';
import { EkuboPool, Quote } from './pool';
import { floatSqrtRatioToFixed } from './math/sqrt-ratio';
import { computeStep, isPriceIncreasing } from './math/swap';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './math/tick';
import { PoolKey, StableswapPoolTypeConfig, SwappedEvent } from './utils';
import { amount0Delta, amount1Delta } from './math/delta';

const GAS_COST_OF_ONE_FULL_RANGE_SWAP = 14_774;

export abstract class FullRangePoolBase<
  S extends FullRangePoolState.Object,
> extends EkuboPool<StableswapPoolTypeConfig, S> {
  protected readonly quoteDataFetcher;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<StableswapPoolTypeConfig>,
  ) {
    const {
      contract: { address },
      interface: iface,
      quoteDataFetcher,
    } = contracts.core;

    super(parentName, dexHelper, logger, initBlockNumber, key, address, iface);

    this.quoteDataFetcher = quoteDataFetcher;
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<S>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return quoteFullRange(this.key, amount, isToken1, state, sqrtRatioLimit);
  }

  protected _computeTvl(state: DeepReadonly<S>): [bigint, bigint] {
    return FullRangePoolState.computeTvl(state);
  }
}

export function quoteFullRange(
  key: PoolKey<StableswapPoolTypeConfig>,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<
    Pick<FullRangePoolState.Object, 'sqrtRatio' | 'liquidity'>
  >,
  sqrtRatioLimit?: bigint,
): Quote<Pick<FullRangePoolState.Object, 'sqrtRatio' | 'liquidity'>> {
  const isIncreasing = isPriceIncreasing(amount, isToken1);

  let sqrtRatio = state.sqrtRatio;
  const liquidity = state.liquidity;

  sqrtRatioLimit ??= isIncreasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;

  const step = computeStep({
    fee: key.config.fee,
    sqrtRatio,
    liquidity,
    isToken1,
    sqrtRatioLimit,
    amount,
  });

  return {
    consumedAmount: step.consumedAmount,
    calculatedAmount: step.calculatedAmount,
    gasConsumed: GAS_COST_OF_ONE_FULL_RANGE_SWAP,
    skipAhead: 0,
    stateAfter: {
      sqrtRatio: step.sqrtRatioNext,
      liquidity,
    },
  };
}

export class FullRangePool extends FullRangePoolBase<FullRangePoolState.Object> {
  public override async generateState(
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

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<FullRangePoolState.Object>,
  ): DeepReadonly<FullRangePoolState.Object> | null {
    return FullRangePoolState.fromPositionUpdatedEvent(
      oldState,
      args.liquidityDelta.toBigInt(),
    );
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    _oldState: DeepReadonly<FullRangePoolState.Object>,
  ): DeepReadonly<FullRangePoolState.Object> | null {
    return FullRangePoolState.fromSwappedEvent(ev);
  }
}

export namespace FullRangePoolState {
  // Needs to be serializiable, therefore can't make it a class
  export type Object = {
    sqrtRatio: bigint;
    liquidity: bigint;
  };

  export function fromPoolInitialization(
    state: PoolInitializationState,
  ): DeepReadonly<Object> {
    return {
      sqrtRatio: state.sqrtRatio,
      liquidity: 0n,
    };
  }

  export function fromQuoter(data: BasicQuoteData): DeepReadonly<Object> {
    const liquidity = data.liquidity.toBigInt();
    const sqrtRatioFloat = data.sqrtRatio.toBigInt();

    return {
      sqrtRatio: floatSqrtRatioToFixed(sqrtRatioFloat),
      liquidity,
    };
  }

  export function fromPositionUpdatedEvent(
    oldState: DeepReadonly<Object>,
    liquidityDelta: bigint,
  ): Object | null {
    if (liquidityDelta === 0n) {
      return null;
    }

    const clonedState = structuredClone(oldState) as DeepWritable<
      typeof oldState
    >;

    clonedState.liquidity += liquidityDelta;

    return clonedState;
  }

  export function fromSwappedEvent(ev: SwappedEvent): Object {
    return {
      liquidity: ev.liquidityAfter,
      sqrtRatio: ev.sqrtRatioAfter,
    };
  }

  export function computeTvl(state: Object): [bigint, bigint] {
    const { sqrtRatio, liquidity } = state;

    return [
      amount0Delta(sqrtRatio, MAX_SQRT_RATIO, liquidity, false),
      amount1Delta(MIN_SQRT_RATIO, sqrtRatio, liquidity, false),
    ];
  }
}
