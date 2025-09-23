import _ from 'lodash';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import { BasicQuoteData, EkuboContracts } from '../types';
import { EkuboPool, NamedEventHandlers, PoolKeyed, Quote } from './iface';
import { floatSqrtRatioToFixed } from './math/price';
import { computeStep, isPriceIncreasing } from './math/swap';
import {
  approximateNumberOfTickSpacingsCrossed,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  toSqrtRatio,
} from './math/tick';
import { parseSwappedEvent, PoolKey, SwappedEvent } from './utils';

const GAS_COST_OF_ONE_CL_SWAP = 24_000;
const GAS_COST_OF_ONE_INITIALIZED_TICK_CROSSED = 9_400;
const GAS_COST_OF_ONE_TICK_SPACING_CROSSED = 4_000;

export class BasePool extends EkuboPool<BasePoolState.Object> {
  private readonly dataFetcher;

  constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    key: PoolKey,
  ) {
    const {
      contract: { address },
      interface: iface,
      dataFetcher,
    } = contracts.core;

    super(
      parentName,
      dexHelper,
      logger,
      key,
      {
        [address]: new NamedEventHandlers(iface, {
          PositionUpdated: (args, oldState) => {
            if (key.num_id !== BigInt(args.poolId)) {
              return null;
            }

            const params = args.params;

            return BasePoolState.fromPositionUpdatedEvent(
              oldState,
              [params.bounds.lower, params.bounds.upper],
              params.liquidityDelta.toBigInt(),
            );
          },
        }),
      },
      {
        [address]: (data, oldState) => {
          const ev = parseSwappedEvent(data);

          if (key.num_id !== ev.poolId) {
            return null;
          }

          return BasePoolState.fromSwappedEvent(oldState, ev);
        },
      },
      quote,
    );

    this.dataFetcher = dataFetcher;
  }

  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<BasePoolState.Object>> {
    const data = await this.dataFetcher.getQuoteData([this.key.toAbi()], 10, {
      blockTag: blockNumber,
    });
    return BasePoolState.fromQuoter(data[0]);
  }

  /*public computeTvl(): [bigint, bigint] | null {
    const state = this.getStaleState();
    if (state === null) {
      return null;
    }

    return BasePoolState.computeTvl(state);
  }*/
}

function quote(
  this: PoolKeyed,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<BasePoolState.Object>,
): Quote {
  const isIncreasing = isPriceIncreasing(amount, isToken1);

  let { sqrtRatio, liquidity, activeTickIndex, sortedTicks } = state;

  const sqrtRatioLimit = isIncreasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;

  let calculatedAmount = 0n;
  let initializedTicksCrossed = 0;
  let amountRemaining = amount;

  const startingSqrtRatio = sqrtRatio;

  while (amountRemaining !== 0n && sqrtRatio !== sqrtRatioLimit) {
    const nextInitializedTick =
      (isIncreasing
        ? sortedTicks[activeTickIndex === null ? 0 : activeTickIndex + 1]
        : activeTickIndex === null
        ? null
        : sortedTicks[activeTickIndex]) ?? null;

    const nextInitializedTickSqrtRatio = nextInitializedTick
      ? toSqrtRatio(nextInitializedTick.number)
      : null;

    const stepSqrtRatioLimit =
      nextInitializedTickSqrtRatio === null
        ? sqrtRatioLimit
        : nextInitializedTickSqrtRatio < sqrtRatioLimit === isIncreasing
        ? nextInitializedTickSqrtRatio
        : sqrtRatioLimit;

    const step = computeStep({
      fee: this.key.config.fee,
      sqrtRatio,
      liquidity,
      isToken1,
      sqrtRatioLimit: stepSqrtRatioLimit,
      amount: amountRemaining,
    });

    amountRemaining -= step.consumedAmount;
    calculatedAmount += step.calculatedAmount;
    sqrtRatio = step.sqrtRatioNext;

    // Cross the tick if the price moved all the way to the next initialized tick price
    if (nextInitializedTick && sqrtRatio === nextInitializedTickSqrtRatio) {
      activeTickIndex = isIncreasing
        ? activeTickIndex === null
          ? 0
          : activeTickIndex + 1
        : activeTickIndex
        ? activeTickIndex - 1
        : null;
      initializedTicksCrossed++;
      liquidity += isIncreasing
        ? nextInitializedTick.liquidityDelta
        : -nextInitializedTick.liquidityDelta;
    }
  }

  const tickSpacingsCrossed = approximateNumberOfTickSpacingsCrossed(
    startingSqrtRatio,
    sqrtRatio,
    this.key.config.tickSpacing,
  );

  return {
    consumedAmount: amount - amountRemaining,
    calculatedAmount,
    gasConsumed:
      GAS_COST_OF_ONE_CL_SWAP +
      initializedTicksCrossed * GAS_COST_OF_ONE_INITIALIZED_TICK_CROSSED +
      tickSpacingsCrossed * GAS_COST_OF_ONE_TICK_SPACING_CROSSED,
    skipAhead:
      initializedTicksCrossed === 0
        ? 0
        : Math.floor(tickSpacingsCrossed / initializedTicksCrossed),
  };
}

export interface Tick {
  readonly number: number;
  liquidityDelta: bigint;
}

/**
 * Returns the index in the sorted tick array that has the greatest value of tick that is not greater than the given tick
 * @param sortedTicks the sorted list of ticks to search in
 * @param tick the tick to search for
 */
export function findNearestInitializedTickIndex(
  sortedTicks: Tick[],
  tick: number,
): number | null {
  let l = 0,
    r = sortedTicks.length;

  while (l < r) {
    const mid = Math.floor((l + r) / 2);
    const midTick = sortedTicks[mid].number;
    if (midTick <= tick) {
      // If it's the last index, or the next tick is greater, we've found our index
      if (
        mid === sortedTicks.length - 1 ||
        sortedTicks[mid + 1].number > tick
      ) {
        return mid;
      } else {
        // Otherwise our value is to the right of this one
        l = mid;
      }
    } else {
      // The mid tick is greater than the one we want, so we know it's not mid
      r = mid;
    }
  }

  return null;
}

export namespace BasePoolState {
  // Needs to be serializiable, therefore can't make it a class
  export type Object = {
    sqrtRatio: bigint;
    liquidity: bigint;
    activeTick: number;
    readonly sortedTicks: Tick[];
    activeTickIndex: number | null;
    readonly checkedTicksBounds: readonly [number, number];
  };

  export function fromQuoter(data: BasicQuoteData): DeepReadonly<Object> {
    const sortedTicks = data.ticks.map(({ number, liquidityDelta }) => ({
      number,
      liquidityDelta: liquidityDelta.toBigInt(),
    }));
    const liquidity = data.liquidity.toBigInt();
    const sqrtRatioFloat = data.sqrtRatio.toBigInt();

    const state: Object = {
      sqrtRatio: floatSqrtRatioToFixed(sqrtRatioFloat),
      liquidity,
      activeTick: data.tick,
      sortedTicks,
      activeTickIndex: null, // This will be filled in
      checkedTicksBounds: [data.minTick, data.maxTick],
    };

    addLiquidityCutoffs(state);

    return state;
  }

  export function fromSwappedEvent(
    oldState: DeepReadonly<Object>,
    ev: SwappedEvent,
  ): Object {
    const sortedTicks = oldState.sortedTicks;

    const clonedTicks = _.cloneDeep(sortedTicks) as DeepWritable<
      typeof sortedTicks
    >;

    return {
      sqrtRatio: ev.sqrtRatioAfter,
      liquidity: ev.liquidityAfter,
      activeTick: ev.tickAfter,
      sortedTicks: clonedTicks,
      activeTickIndex: findNearestInitializedTickIndex(
        clonedTicks,
        ev.tickAfter,
      ),
      checkedTicksBounds: oldState.checkedTicksBounds,
    };
  }

  export function fromPositionUpdatedEvent(
    oldState: DeepReadonly<Object>,
    [lowTick, highTick]: [number, number],
    liquidityDelta: bigint,
  ): Object | null {
    if (liquidityDelta === 0n) {
      return null;
    }

    const clonedState = _.cloneDeep(oldState) as DeepWritable<typeof oldState>;

    updateTick(clonedState, lowTick, liquidityDelta, false, false);
    updateTick(clonedState, highTick, liquidityDelta, true, false);

    if (
      clonedState.activeTick >= lowTick &&
      clonedState.activeTick < highTick
    ) {
      clonedState.liquidity += liquidityDelta;
    }

    return clonedState;
  }

  export function addLiquidityCutoffs(state: BasePoolState.Object) {
    const { sortedTicks, liquidity, activeTick } = state;

    let activeTickIndex = undefined;
    let currentLiquidity = 0n;

    // The liquidity added/removed by out-of-range initialized ticks (i.e. lower than minCheckedTickNumber)
    let liquidityDeltaMin = 0n;

    for (let i = 0; i < sortedTicks.length; i++) {
      const tick = sortedTicks[i];

      if (typeof activeTickIndex === 'undefined' && activeTick < tick.number) {
        activeTickIndex = i === 0 ? null : i - 1;

        liquidityDeltaMin = liquidity - currentLiquidity;

        // We now need to switch to tracking the liquidity that needs to be cut off at maxCheckedTickNumber, therefore reset to the actual liquidity
        currentLiquidity = liquidity;
      }

      currentLiquidity += tick.liquidityDelta;
    }

    if (typeof activeTickIndex === 'undefined') {
      activeTickIndex = sortedTicks.length > 0 ? sortedTicks.length - 1 : null;
      liquidityDeltaMin = liquidity - currentLiquidity;
      currentLiquidity = liquidity;
    }

    state.activeTickIndex = activeTickIndex;

    BasePoolState.updateTick(
      state,
      state.checkedTicksBounds[0],
      liquidityDeltaMin,
      false,
      true,
    );

    BasePoolState.updateTick(
      state,
      state.checkedTicksBounds[1],
      currentLiquidity,
      true,
      true,
    );
  }

  export function updateTick(
    state: Object,
    updatedTickNumber: number,
    liquidityDelta: bigint,
    upper: boolean,
    forceInsert: boolean,
  ) {
    const sortedTicks = state.sortedTicks;

    if (upper) {
      liquidityDelta = -liquidityDelta;
    }

    const nearestTickIndex = findNearestInitializedTickIndex(
      sortedTicks,
      updatedTickNumber,
    );
    const nearestTick =
      nearestTickIndex === null ? null : sortedTicks[nearestTickIndex];
    const nearestTickNumber = nearestTick?.number;
    const newTickReferenced = nearestTickNumber !== updatedTickNumber;

    if (newTickReferenced) {
      if (!forceInsert && nearestTickIndex === null) {
        sortedTicks[0].liquidityDelta += liquidityDelta;
      } else if (!forceInsert && nearestTickIndex === sortedTicks.length - 1) {
        sortedTicks[sortedTicks.length - 1].liquidityDelta += liquidityDelta;
      } else {
        sortedTicks.splice(
          nearestTickIndex === null ? 0 : nearestTickIndex + 1,
          0,
          {
            number: updatedTickNumber,
            liquidityDelta,
          },
        );

        if (state.activeTick >= updatedTickNumber) {
          state.activeTickIndex =
            state.activeTickIndex === null ? 0 : state.activeTickIndex + 1;
        }
      }
    } else {
      const newDelta = nearestTick!.liquidityDelta + liquidityDelta;

      if (
        newDelta === 0n &&
        !state.checkedTicksBounds.includes(nearestTickNumber)
      ) {
        sortedTicks.splice(nearestTickIndex!, 1);

        if (state.activeTick >= updatedTickNumber) {
          state.activeTickIndex!--;
        }
      } else {
        nearestTick!.liquidityDelta = newDelta;
      }
    }
  }

  /*export function computeTvl(state: DeepReadonly<Object>): [bigint, bigint] {
    const stateSqrtRatio = state.sqrtRatio;

    let [tvl0, tvl1] = [0n, 0n];
    let liquidity = 0n;
    let sqrtRatio = MIN_SQRT_RATIO;

    for (const tick of state.sortedTicks) {
      const tickSqrtRatio = toSqrtRatio(tick.number);

      const minAmount1SqrtRatio =
        stateSqrtRatio > tickSqrtRatio ? tickSqrtRatio : stateSqrtRatio;
      const maxAmount0SqrtRatio =
        stateSqrtRatio > sqrtRatio ? stateSqrtRatio : sqrtRatio;

      if (sqrtRatio < minAmount1SqrtRatio) {
        tvl1 += amount1Delta(sqrtRatio, minAmount1SqrtRatio, liquidity, false);
      }

      if (maxAmount0SqrtRatio < tickSqrtRatio) {
        tvl0 += amount0Delta(
          maxAmount0SqrtRatio,
          tickSqrtRatio,
          liquidity,
          false,
        );
      }

      sqrtRatio = tickSqrtRatio;
      liquidity += tick.liquidityDelta;
    }

    return [tvl0, tvl1];
  }*/
}
