import { hexDataSlice } from 'ethers/lib/utils';
import { Logger } from 'log4js';
import { Result } from '@ethersproject/abi';
import { BigNumber } from 'ethers';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import {
  BasicQuoteData,
  BoostedFeesQuoteData,
  EkuboContracts,
  PoolInitializationState,
} from '../types';
import {
  ConcentratedPoolBase,
  ConcentratedPoolState,
  GAS_COST_OF_ONE_EXTRA_BITMAP_SLOAD,
  quoteConcentrated,
} from './concentrated';
import { NamedEventHandlers, Quote } from './pool';
import { ConcentratedPoolTypeConfig, PoolKey, SwappedEvent } from './utils';
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

export class BoostedFeesPool extends ConcentratedPoolBase<BoostedFeesPoolState.Object> {
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
        [boostedFeesAddress]: new NamedEventHandlers(boostedFeesIface, {
          PoolBoosted: (args, oldState) =>
            BoostedFeesPoolState.fromPoolBoostedEvent(
              oldState,
              [args.startTime.toBigInt(), args.endTime.toBigInt()],
              [args.rate0.toBigInt(), args.rate1.toBigInt()],
            ),
        }),
      },
      {
        [boostedFeesAddress]: (data, oldState, blockHeader) =>
          BoostedFeesPoolState.fromFeesDonatedEvent(
            oldState,
            parseFeesDonatedEvent(data),
            BigInt(blockHeader.timestamp),
          ),
      },
    );

    this.boostedFeesDataFetcher = boostedFeesDataFetcher;
  }

  public override async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<BoostedFeesPoolState.Object>> {
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
    state: DeepReadonly<BoostedFeesPoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return quoteBoostedFees(this.key, amount, isToken1, state, sqrtRatioLimit);
  }

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<BoostedFeesPoolState.Object>,
  ): DeepReadonly<BoostedFeesPoolState.Object> | null {
    const [lower, upper] = [
      BigNumber.from(hexDataSlice(args.positionId, 24, 28))
        .fromTwos(32)
        .toNumber(),
      BigNumber.from(hexDataSlice(args.positionId, 28, 32))
        .fromTwos(32)
        .toNumber(),
    ];

    return BoostedFeesPoolState.fromPositionUpdatedEvent(
      oldState,
      [lower, upper],
      args.liquidityDelta.toBigInt(),
    );
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    oldState: DeepReadonly<BoostedFeesPoolState.Object>,
  ): DeepReadonly<BoostedFeesPoolState.Object> | null {
    return BoostedFeesPoolState.fromSwappedEvent(oldState, ev);
  }
}

export function quoteBoostedFees(
  key: PoolKey<ConcentratedPoolTypeConfig>,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<BoostedFeesPoolState.Object>,
  sqrtRatioLimit?: bigint,
  overrideTime?: bigint,
): Quote<
  Pick<
    ConcentratedPoolState.Object,
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

  const realLastDonateTime = realLastTime(currentTime, truncatedLastDonateTime);

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

  const quote = quoteConcentrated(key, amount, isToken1, state, sqrtRatioLimit);

  quote.gasConsumed +=
    EXTRA_BASE_GAS_COST_OF_ONE_BOOSTED_FEES_SWAP +
    Number(currentTime !== realLastDonateTime) *
      GAS_COST_OF_EXECUTING_VIRTUAL_DONATIONS +
    Number(feesAccumulated) * GAS_COST_OF_BOOSTED_FEES_FEE_ACCUMULATION +
    approximateExtraDistinctTimeBitmapLookups(realLastDonateTime, currentTime) *
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

export namespace BoostedFeesPoolState {
  export type DonateRateDelta = TimedPoolState.TimeRateDelta;

  export interface Object extends ConcentratedPoolState.Object {
    timedPoolState: TimedPoolState.Object;
  }

  export function fromPoolInitialization(
    state: PoolInitializationState,
  ): DeepReadonly<Object> {
    return {
      ...ConcentratedPoolState.fromPoolInitialization(state),
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
      ...ConcentratedPoolState.fromQuoter(quoteData),
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
      ...ConcentratedPoolState.fromSwappedEvent(oldState, ev),
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
    const concentratedState = ConcentratedPoolState.fromPositionUpdatedEvent(
      oldState,
      ticks,
      liquidityDelta,
    );
    if (concentratedState === null) {
      return null;
    }

    return {
      ...concentratedState,
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
