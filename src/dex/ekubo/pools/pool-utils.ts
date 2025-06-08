import _ from 'lodash';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { Tick, QuoteData, AbiPoolKey } from '../types';
import { amount1Delta, amount0Delta } from './math/delta';
import { floatSqrtRatioToFixed } from './math/price';
import { MIN_TICK, MAX_TICK, MIN_SQRT_RATIO, toSqrtRatio } from './math/tick';
import { defaultAbiCoder } from '@ethersproject/abi';
import { zeroPadValue, toBeHex } from 'ethers';
import { keccak256 } from 'web3-utils';
import { hexStringTokenPair } from '../utils';

export namespace PoolState {
  // Needs to be serializiable, therefore can't make it a class
  export type Object = {
    sqrtRatio: bigint;
    liquidity: bigint;
    activeTick: number;
    readonly sortedTicks: Tick[];
    activeTickIndex: number | null;
    readonly checkedTicksBounds: readonly [number, number];
  };

  export function fromQuoter(data: QuoteData, isFullRange: boolean): Object {
    const sortedTicks = data.ticks.map(({ number, liquidityDelta }) => ({
      number,
      liquidityDelta,
    }));
    const liquidity = data.liquidity;

    const sqrtRatioFloat = data.sqrtRatio;

    const checkedTicksBounds: [number, number] = isFullRange
      ? [MIN_TICK, MAX_TICK]
      : [data.minTick, data.maxTick];

    const state: Object = {
      sqrtRatio:
        sqrtRatioFloat === 0n
          ? 2n ** 128n
          : floatSqrtRatioToFixed(sqrtRatioFloat),
      liquidity,
      activeTick: data.tick,
      sortedTicks,
      activeTickIndex: null, // This will be filled in
      checkedTicksBounds,
    };

    addLiquidityCutoffs(state);

    return state;
  }

  export function fromSwappedEvent(
    oldState: DeepReadonly<Object>,
    sqrtRatioAfter: bigint,
    liquidityAfter: bigint,
    tickAfter: number,
  ): Object {
    const sortedTicks = oldState.sortedTicks;

    const clonedTicks = _.cloneDeep(sortedTicks) as DeepWritable<
      typeof sortedTicks
    >;

    return {
      sqrtRatio: sqrtRatioAfter,
      liquidity: liquidityAfter,
      activeTick: tickAfter,
      sortedTicks: clonedTicks,
      activeTickIndex: findNearestInitializedTickIndex(clonedTicks, tickAfter),
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

  export function addLiquidityCutoffs(state: PoolState.Object) {
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

    PoolState.updateTick(
      state,
      state.checkedTicksBounds[0],
      liquidityDeltaMin,
      false,
      true,
    );

    PoolState.updateTick(
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

  export function computeTvl(state: DeepReadonly<Object>): [bigint, bigint] {
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
  }
}

export class PoolKey {
  private _string_id?: string;
  private _num_id?: bigint;

  public constructor(
    public readonly token0: bigint,
    public readonly token1: bigint,
    public readonly config: PoolConfig,
  ) {}

  public get string_id(): string {
    this._string_id ??= `${hexStringTokenPair(this.token0, this.token1)}_${
      this.config.fee
    }_${this.config.tickSpacing}_${zeroPadValue(
      toBeHex(this.config.extension),
      20,
    )}`;

    return this._string_id;
  }

  public get num_id(): bigint {
    this._num_id ??= BigInt(
      keccak256(
        defaultAbiCoder.encode(
          ['address', 'address', 'bytes32'],
          [
            zeroPadValue(toBeHex(this.token0), 20),
            zeroPadValue(toBeHex(this.token1), 20),
            zeroPadValue(toBeHex(this.config.compressed), 32),
          ],
        ),
      ),
    );

    return this._num_id;
  }

  public toAbi(): AbiPoolKey {
    return {
      token0: zeroPadValue(toBeHex(this.token0), 20),
      token1: zeroPadValue(toBeHex(this.token1), 20),
      config: zeroPadValue(toBeHex(this.config.compressed), 32),
    };
  }
}

export class PoolConfig {
  public constructor(
    public readonly tickSpacing: number,
    public readonly fee: bigint,
    public readonly extension: bigint,
    private _compressed?: bigint,
  ) {}

  public get compressed(): bigint {
    this._compressed ??=
      BigInt(this.tickSpacing) + (this.fee << 32n) + (this.extension << 96n);
    return this._compressed;
  }

  public static fromCompressed(compressed: bigint) {
    return new this(
      Number(compressed % 2n ** 32n),
      (compressed >> 32n) % 2n ** 64n,
      compressed >> 96n,
      compressed,
    );
  }
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
      // if it's the last index, or the next tick is greater, we've found our index
      if (
        mid === sortedTicks.length - 1 ||
        sortedTicks[mid + 1].number > tick
      ) {
        return mid;
      } else {
        // otherwise our value is to the right of this one
        l = mid;
      }
    } else {
      // the mid tick is greater than the one we want, so we know it's not mid
      r = mid;
    }
  }

  return null;
}
