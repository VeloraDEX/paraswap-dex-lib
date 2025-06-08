import { Interface, Result } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../../types';
import { catchParseLogError } from '../../../utils';
import { StatefulEventSubscriber } from '../../../stateful-event-subscriber';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Contract } from 'ethers';
import _ from 'lodash';
import { computeStep, isPriceIncreasing } from './math/swap';
import {
  approximateNumberOfTickSpacingsCrossed,
  FULL_RANGE_TICK_SPACING,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  toSqrtRatio,
} from './math/tick';
import { floatSqrtRatioToFixed } from './math/price';
import { PoolState, PoolKey } from './pool-utils';

export interface Quote {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  gasConsumed: number;
  skipAhead: number;
}

const BASE_GAS_COST = 46_000;
const GAS_COST_OF_ONE_INITIALIZED_TICK_CROSSED = 9_400;
const GAS_COST_OF_ONE_TICK_SPACING_CROSSED = 4_000;

export class BasePool extends StatefulEventSubscriber<PoolState.Object> {
  public readonly addressesSubscribed: string[];

  constructor(
    public readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    private readonly coreIface: Interface,
    private readonly dataFetcher: Contract,
    public readonly key: PoolKey,
    coreAddress: string,
    core: Contract,
  ) {
    super(parentName, key.string_id, dexHelper, logger);

    this.addressesSubscribed = [coreAddress];
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected processLog(
    state: DeepReadonly<PoolState.Object>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState.Object> | null {
    if (log.topics.length === 0) {
      return this.handleSwappedEvent(log.data, state);
    }

    try {
      const event = this.coreIface.parseLog(log);

      if (event.name === 'PositionUpdated') {
        return this.handlePositionUpdatedEvent(event.args, state);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolState.Object>> {
    const data = await this.dataFetcher.getQuoteData([this.key.toAbi()], 10, {
      blockTag: blockNumber,
    });
    return PoolState.fromQuoter(
      data[0],
      this.key.config.tickSpacing === FULL_RANGE_TICK_SPACING,
    );
  }

  handleSwappedEvent(
    data: string,
    oldState: DeepReadonly<PoolState.Object>,
  ): DeepReadonly<PoolState.Object> | null {
    let n = BigInt(data);

    const poolId = (n >> 512n) & ((1n << 256n) - 1n);

    if (this.key.num_id !== poolId) {
      return null;
    }

    // tick: int32 (4 bytes)
    const tickRaw = n & ((1n << 32n) - 1n);
    const tickAfter = Number(toSigned(tickRaw, 32));
    n >>= 32n;

    // sqrtRatio: uint96 (12 bytes)
    const sqrtRatioAfterCompact = n & ((1n << 96n) - 1n);
    n >>= 96n;

    const sqrtRatioAfter = floatSqrtRatioToFixed(sqrtRatioAfterCompact);

    // liquidity: uint128 (16 bytes)
    const liquidityAfter = n & ((1n << 128n) - 1n);

    return PoolState.fromSwappedEvent(
      oldState,
      sqrtRatioAfter,
      liquidityAfter,
      tickAfter,
    );
  }

  handlePositionUpdatedEvent(
    args: Result,
    oldState: DeepReadonly<PoolState.Object>,
  ): DeepReadonly<PoolState.Object> | null {
    if (this.key.num_id !== BigInt(args.poolId)) {
      return null;
    }

    const params = args.params;

    return PoolState.fromPositionUpdatedEvent(
      oldState,
      [params.bounds.lower, params.bounds.upper],
      params.liquidityDelta.toBigInt(),
    );
  }

  public quote(amount: bigint, token: bigint, blockNumber: number): Quote {
    const isToken1 = token === this.key.token1;

    if (!isToken1 && this.key.token0 !== token) {
      throw new Error('Invalid token');
    }

    if (amount === 0n) {
      return {
        consumedAmount: 0n,
        calculatedAmount: 0n,
        gasConsumed: 0,
        skipAhead: 0,
      };
    }

    const isIncreasing = isPriceIncreasing(amount, isToken1);

    let state = this.getState(blockNumber);
    if (state === null) {
      throw new Error(
        `Quote for block number ${blockNumber} requested but state is not recent enough`,
      );
    }

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

      // cross the tick if the price moved all the way to the next initialized tick price
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
        BASE_GAS_COST +
        initializedTicksCrossed * GAS_COST_OF_ONE_INITIALIZED_TICK_CROSSED +
        tickSpacingsCrossed * GAS_COST_OF_ONE_TICK_SPACING_CROSSED,
      skipAhead:
        initializedTicksCrossed === 0
          ? 0
          : Math.floor(tickSpacingsCrossed / initializedTicksCrossed),
    };
  }

  public computeTvl(): [bigint, bigint] | null {
    const state = this.getStaleState();
    if (state === null) {
      return null;
    }

    return PoolState.computeTvl(state);
  }
}

function toSigned(value: bigint, bits: number): bigint {
  const half = 1n << BigInt(bits - 1);
  return value >= half ? value - (1n << BigInt(bits)) : value;
}
