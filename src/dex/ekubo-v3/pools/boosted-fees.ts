import { BigNumber } from 'ethers';
import { hexDataSlice } from 'ethers/lib/utils';
import { Logger } from 'log4js';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import {
  BasicQuoteData,
  BoostedFeesQuoteData,
  EkuboContracts,
  PoolInitializationState,
} from '../types';
import {
  BasePool,
  BasePoolState,
  GAS_COST_OF_ONE_EXTRA_BITMAP_SLOAD,
} from './base';
import { NamedEventHandlers, Quote } from './pool';
import {
  ConcentratedPoolTypeConfig,
  parseSwappedEvent,
  PoolKey,
  SwappedEvent,
} from './utils';
import {
  approximateExtraDistinctTimeBitmapLookups,
  estimatedCurrentTime,
  realLastTime,
  TimedPoolState,
} from './timed';

const EXTRA_BASE_GAS_COST_OF_ONE_BOOSTED_FEES_SWAP = 2_743;
const GAS_COST_OF_EXECUTING_VIRTUAL_DONATIONS = 6_814;
const GAS_COST_OF_ONE_VIRTUAL_DONATE_DELTA = 4_271;
const GAS_COST_OF_BOOSTED_FEES_FEE_ACCUMULATION = 19_279;

export class BoostedFeesPool extends BasePool {
  private readonly boostedFeesDataFetcher;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<ConcentratedPoolTypeConfig>,
  ) {
    const {
      contract: { address: coreAddress },
      interface: coreIface,
    } = contracts.core;
    const {
      contract: { address: boostedFeesAddress },
      interface: boostedFeesIface,
      quoteDataFetcher: boostedFeesDataFetcher,
    } = contracts.boostedFees;

    super(
      parentName,
      dexHelper,
      logger,
      contracts,
      initBlockNumber,
      key,
      {
        [coreAddress]: new NamedEventHandlers(coreIface, {
          PositionUpdated: (args, oldState) => {
            const [lower, upper] = [
              BigNumber.from(hexDataSlice(args.positionId, 24, 28))
                .fromTwos(32)
                .toNumber(),
              BigNumber.from(hexDataSlice(args.positionId, 28, 32))
                .fromTwos(32)
                .toNumber(),
            ];

            return BoostedFeesPoolState.fromPositionUpdatedEvent(
              oldState as DeepReadonly<BoostedFeesPoolState.Object>,
              [lower, upper],
              args.liquidityDelta.toBigInt(),
            ) as BasePoolState.Object | null;
          },
        }),
        [boostedFeesAddress]: new NamedEventHandlers(boostedFeesIface, {
          PoolBoosted: (args, oldState) =>
            BoostedFeesPoolState.fromPoolBoostedEvent(
              oldState as DeepReadonly<BoostedFeesPoolState.Object>,
              [args.startTime.toBigInt(), args.endTime.toBigInt()],
              [args.rate0.toBigInt(), args.rate1.toBigInt()],
            ) as BasePoolState.Object | null,
        }),
      },
      {
        [coreAddress]: (data, oldState) =>
          BoostedFeesPoolState.fromSwappedEvent(
            oldState as DeepReadonly<BoostedFeesPoolState.Object>,
            parseSwappedEvent(data),
          ) as BasePoolState.Object,
        [boostedFeesAddress]: (data, oldState, blockHeader) =>
          BoostedFeesPoolState.fromFeesDonatedEvent(
            oldState as DeepReadonly<BoostedFeesPoolState.Object>,
            parseFeesDonatedEvent(data),
            BigInt(blockHeader.timestamp),
          ) as BasePoolState.Object | null,
      },
    );

    this.boostedFeesDataFetcher = boostedFeesDataFetcher;
  }

  public override async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<BasePoolState.Object>> {
    const [quoteData, boostedFeesData] = await Promise.all([
      this.quoteDataFetcher.getQuoteData([this.key.toAbi()], 10, {
        blockTag: blockNumber,
      }) as Promise<BasicQuoteData[]>,
      this.boostedFeesDataFetcher.getPoolState(this.key.toAbi(), {
        blockTag: blockNumber,
      }) as Promise<BoostedFeesQuoteData>,
    ]);

    return BoostedFeesPoolState.fromQuoter(quoteData[0], boostedFeesData);
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<BasePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return this.quoteBoostedFees(
      amount,
      isToken1,
      state as DeepReadonly<BoostedFeesPoolState.Object>,
      sqrtRatioLimit,
    );
  }

  public quoteBoostedFees(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<BoostedFeesPoolState.Object>,
    sqrtRatioLimit?: bigint,
    overrideTime?: bigint,
  ): Quote<
    Pick<
      BasePoolState.Object,
      'activeTickIndex' | 'sqrtRatio' | 'liquidity'
    > & {
      timedPoolState: TimedPoolState.Object;
    }
  > {
    const lastDonateTime = state.timedPoolState.lastTime;
    const currentTime = estimatedCurrentTime(lastDonateTime, overrideTime);

    let donateRate0 = state.timedPoolState.token0Rate;
    let donateRate1 = state.timedPoolState.token1Rate;
    let feesAccumulated = false;
    let virtualDonateDeltaTimesCrossed = 0;

    const truncatedLastDonateTime = BigInt.asUintN(32, lastDonateTime);

    const realLastDonateTime = realLastTime(
      currentTime,
      truncatedLastDonateTime,
    );

    let time = realLastDonateTime;

    for (const delta of [...state.timedPoolState.virtualDeltas, null]) {
      let nextDonateTime = currentTime;
      let lastDelta = true;

      if (delta !== null) {
        if (delta.time <= realLastDonateTime) {
          continue;
        }

        if (delta.time < currentTime) {
          lastDelta = false;
          nextDonateTime = delta.time;
        }
      }

      const timeDiff = nextDonateTime - time;
      feesAccumulated ||=
        (donateRate0 * timeDiff) >> 32n !== 0n ||
        (donateRate1 * timeDiff) >> 32n !== 0n;

      if (delta === null || lastDelta) {
        break;
      }

      donateRate0 += delta.delta0;
      donateRate1 += delta.delta1;
      time = delta.time;
      virtualDonateDeltaTimesCrossed++;
    }

    const quote = BasePool.prototype.quoteBase.call(
      this,
      amount,
      isToken1,
      state,
      sqrtRatioLimit,
    );

    quote.gasConsumed +=
      EXTRA_BASE_GAS_COST_OF_ONE_BOOSTED_FEES_SWAP +
      Number(currentTime !== realLastDonateTime) *
        GAS_COST_OF_EXECUTING_VIRTUAL_DONATIONS +
      Number(feesAccumulated) * GAS_COST_OF_BOOSTED_FEES_FEE_ACCUMULATION +
      approximateExtraDistinctTimeBitmapLookups(
        realLastDonateTime,
        currentTime,
      ) *
        GAS_COST_OF_ONE_EXTRA_BITMAP_SLOAD +
      virtualDonateDeltaTimesCrossed * GAS_COST_OF_ONE_VIRTUAL_DONATE_DELTA;

    return {
      ...quote,
      stateAfter: {
        ...quote.stateAfter,
        timedPoolState: {
          token0Rate: donateRate0,
          token1Rate: donateRate1,
          lastTime: currentTime,
          virtualDeltas: state.timedPoolState
            .virtualDeltas as TimedPoolState.TimeRateDelta[],
        },
      },
    };
  }
}

export namespace BoostedFeesPoolState {
  export type DonateRateDelta = TimedPoolState.TimeRateDelta;

  export interface Object extends BasePoolState.Object {
    timedPoolState: TimedPoolState.Object;
  }

  export function fromPoolInitialization(
    state: PoolInitializationState,
  ): DeepReadonly<Object> {
    return {
      ...BasePoolState.fromPoolInitialization(state),
      timedPoolState: {
        token0Rate: 0n,
        token1Rate: 0n,
        lastTime: BigInt(state.blockHeader.timestamp),
        virtualDeltas: [],
      },
    };
  }

  export function fromQuoter(
    quoteData: BasicQuoteData,
    boostedData: BoostedFeesQuoteData,
  ): DeepReadonly<Object> {
    return {
      ...BasePoolState.fromQuoter(quoteData),
      timedPoolState: TimedPoolState.fromQuoter(
        boostedData.donateRateToken0.toBigInt(),
        boostedData.donateRateToken1.toBigInt(),
        boostedData.lastDonateTime.toBigInt(),
        boostedData.donateRateDeltas.map(delta => ({
          time: delta.time.toBigInt(),
          delta0: delta.donateRateDelta0.toBigInt(),
          delta1: delta.donateRateDelta1.toBigInt(),
        })),
      ),
    };
  }

  export function fromSwappedEvent(
    oldState: DeepReadonly<Object>,
    ev: SwappedEvent,
  ): Object {
    return {
      ...BasePoolState.fromSwappedEvent(oldState, ev),
      timedPoolState: structuredClone(
        oldState.timedPoolState,
      ) as TimedPoolState.Object,
    };
  }

  export function fromPositionUpdatedEvent(
    oldState: DeepReadonly<Object>,
    ticks: [number, number],
    liquidityDelta: bigint,
  ): Object | null {
    const baseState = BasePoolState.fromPositionUpdatedEvent(
      oldState,
      ticks,
      liquidityDelta,
    );
    if (baseState === null) {
      return null;
    }

    return {
      ...baseState,
      timedPoolState: structuredClone(
        oldState.timedPoolState,
      ) as TimedPoolState.Object,
    };
  }

  export function fromFeesDonatedEvent(
    oldState: DeepReadonly<Object>,
    ev: FeesDonatedEvent,
    blockTimestamp: bigint,
  ): Object {
    const clonedState = structuredClone(oldState) as DeepWritable<
      typeof oldState
    >;

    const timed = clonedState.timedPoolState;

    timed.lastTime = blockTimestamp;
    timed.token0Rate = ev.donateRate0;
    timed.token1Rate = ev.donateRate1;

    TimedPoolState.pruneDeltasAtOrBefore(timed.virtualDeltas, blockTimestamp);

    return clonedState;
  }

  export function fromPoolBoostedEvent(
    oldState: DeepReadonly<Object>,
    [startTime, endTime]: [bigint, bigint],
    [rate0, rate1]: [bigint, bigint],
  ): Object | null {
    if (rate0 === 0n && rate1 === 0n) {
      return null;
    }

    const clonedState = structuredClone(oldState) as DeepWritable<
      typeof oldState
    >;
    TimedPoolState.applyRateDeltaBoundaries(clonedState.timedPoolState, [
      [startTime, rate0, rate1],
      [endTime, -rate0, -rate1],
    ]);

    return clonedState;
  }
}

interface FeesDonatedEvent {
  donateRate0: bigint;
  donateRate1: bigint;
}

function parseFeesDonatedEvent(data: string): FeesDonatedEvent {
  return {
    donateRate0: BigInt(hexDataSlice(data, 32, 46)),
    donateRate1: BigInt(hexDataSlice(data, 46, 60)),
  };
}
