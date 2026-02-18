import { Logger } from 'log4js';
import { Result } from '@ethersproject/abi';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import {
  EkuboContracts,
  PoolInitializationState,
  TwammQuoteData,
} from '../types';
import { FullRangePoolState, quoteFullRange } from './full-range';
import { EkuboPool, NamedEventHandlers, Quote } from './pool';
import { MAX_U32 } from './math/constants';
import { floatSqrtRatioToFixed } from './math/sqrt-ratio';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './math/tick';
import { calculateNextSqrtRatio } from './math/twamm/sqrt-ratio';
import { PoolKey, StableswapPoolTypeConfig, SwappedEvent } from './utils';
import { hexDataSlice } from 'ethers/lib/utils';
import {
  approximateExtraDistinctTimeBitmapLookups,
  estimatedCurrentTime,
  TimedPoolState,
} from './timed';
import { Network } from '../../../constants';
import { EkuboSupportedNetwork } from '../config';

const GAS_COST_OF_ONE_COLD_SLOAD = 2_000;
const BASE_GAS_COST_OF_ONE_TWAMM_SWAP = 21_222;
const GAS_COST_OF_CROSSING_ONE_VIRTUAL_ORDER_DELTA = 19_980;
const GAS_COST_OF_EXECUTING_VIRTUAL_ORDERS = 20_554;

export class TwammPool extends EkuboPool<
  StableswapPoolTypeConfig,
  TwammPoolState.Object
> {
  private readonly twammDataFetcher;
  private readonly chainId: EkuboSupportedNetwork;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<StableswapPoolTypeConfig>,
  ) {
    const {
      contract: { address: coreAddress },
      interface: coreIface,
    } = contracts.core;
    const {
      contract: { address: twammAddress },
      interface: twammIface,
      quoteDataFetcher: twammDataFetcher,
    } = contracts.twamm;

    super(
      parentName,
      dexHelper,
      logger,
      initBlockNumber,
      key,
      coreAddress,
      coreIface,
      {
        [twammAddress]: new NamedEventHandlers(twammIface, {
          OrderUpdated: (args, oldState) => {
            const orderKey = args.orderKey;

            if (
              key.token0 !== BigInt(orderKey.token0) ||
              key.token1 !== BigInt(orderKey.token1) ||
              key.config.fee !== BigInt(hexDataSlice(orderKey.config, 0, 8))
            ) {
              return null;
            }

            const isToken1 = Boolean(
              Number(hexDataSlice(orderKey.config, 8, 9)),
            );

            return TwammPoolState.fromOrderUpdatedEvent(
              oldState,
              [
                BigInt(hexDataSlice(orderKey.config, 16, 24)),
                BigInt(hexDataSlice(orderKey.config, 24, 32)),
              ],
              args.saleRateDelta.toBigInt(),
              isToken1,
            );
          },
        }),
      },
      {
        [twammAddress]: (data, oldState, blockHeader) =>
          TwammPoolState.fromVirtualOrdersExecutedEvent(
            oldState,
            parseVirtualOrdersExecutedEvent(data),
            BigInt(blockHeader.timestamp),
          ),
      },
    );

    this.twammDataFetcher = twammDataFetcher;
    this.chainId = dexHelper.config.data.network;
  }

  public async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<TwammPoolState.Object>> {
    const quoteData = await this.twammDataFetcher.getPoolState(
      this.key.toAbi(),
      {
        blockTag: blockNumber,
      },
    );

    return TwammPoolState.fromQuoter(quoteData);
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<TwammPoolState.Object>,
  ): Quote {
    return quoteTwamm(
      this.key,
      amount,
      isToken1,
      state,
      undefined,
      this.chainId,
    );
  }

  protected _computeTvl(state: TwammPoolState.Object): [bigint, bigint] {
    return FullRangePoolState.computeTvl(state.fullRangePoolState);
  }

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<TwammPoolState.Object>,
  ): DeepReadonly<TwammPoolState.Object> | null {
    return TwammPoolState.fromPositionUpdatedEvent(
      oldState,
      args.liquidityDelta.toBigInt(),
    );
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    oldState: DeepReadonly<TwammPoolState.Object>,
  ): DeepReadonly<TwammPoolState.Object> | null {
    return TwammPoolState.fromSwappedEvent(oldState, ev);
  }
}

export function quoteTwamm(
  key: PoolKey<StableswapPoolTypeConfig>,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<TwammPoolState.Object>,
  overrideTime?: bigint,
  chainId: EkuboSupportedNetwork = Network.MAINNET,
): Quote {
  const lastExecutionTime = state.timedPoolState.lastTime;
  const currentTime =
    overrideTime ?? estimatedCurrentTime(lastExecutionTime, chainId);

  const quoteFullRangePool = (
    quoteAmount: bigint,
    quoteIsToken1: boolean,
    quoteState: DeepReadonly<FullRangePoolState.Object>,
    quoteSqrtRatioLimit?: bigint,
  ) =>
    quoteFullRange(
      key,
      quoteAmount,
      quoteIsToken1,
      quoteState,
      quoteSqrtRatioLimit,
    );

  const liquidity = state.fullRangePoolState.liquidity;
  let nextSqrtRatio = state.fullRangePoolState.sqrtRatio;
  let token0SaleRate = state.timedPoolState.token0Rate;
  let token1SaleRate = state.timedPoolState.token1Rate;

  let virtualOrderDeltaTimesCrossed = 0;

  let fullRangePoolState = state.fullRangePoolState;

  let time = lastExecutionTime;

  for (const delta of [...state.timedPoolState.virtualDeltas, null]) {
    let nextExecutionTime = currentTime;
    let lastDelta = true;

    if (delta !== null) {
      if (delta.time <= lastExecutionTime) {
        continue;
      }

      if (delta.time < currentTime) {
        lastDelta = false;
        nextExecutionTime = delta.time;
      }
    }

    const timeElapsed = nextExecutionTime - time;
    if (timeElapsed > MAX_U32) {
      throw new Error('Too much time passed since last execution');
    }

    const [amount0, amount1] = [
      (token0SaleRate * BigInt(timeElapsed)) >> 32n,
      (token1SaleRate * BigInt(timeElapsed)) >> 32n,
    ];

    if (amount0 > 0n && amount1 > 0n) {
      let currentSqrtRatio = nextSqrtRatio;
      if (currentSqrtRatio > MAX_SQRT_RATIO) {
        currentSqrtRatio = MAX_SQRT_RATIO;
      } else if (currentSqrtRatio < MIN_SQRT_RATIO) {
        currentSqrtRatio = MIN_SQRT_RATIO;
      }

      nextSqrtRatio = calculateNextSqrtRatio(
        currentSqrtRatio,
        liquidity,
        token0SaleRate,
        token1SaleRate,
        timeElapsed,
        key.config.fee,
      );

      const [virtualAmount, virtualIsToken1] =
        currentSqrtRatio < nextSqrtRatio ? [amount1, true] : [amount0, false];

      const quote = quoteFullRangePool(
        virtualAmount,
        virtualIsToken1,
        fullRangePoolState,
        nextSqrtRatio,
      );

      fullRangePoolState = quote.stateAfter;
    } else if (amount0 > 0n || amount1 > 0n) {
      const [virtualAmount, virtualIsToken1] =
        amount0 !== 0n ? [amount0, false] : [amount1, true];

      const quote = quoteFullRangePool(
        virtualAmount,
        virtualIsToken1,
        fullRangePoolState,
      );

      fullRangePoolState = quote.stateAfter;
      nextSqrtRatio = quote.stateAfter.sqrtRatio;
    }

    if (delta === null || lastDelta) {
      break;
    }

    token0SaleRate += delta.delta0;
    token1SaleRate += delta.delta1;
    time = nextExecutionTime;
    virtualOrderDeltaTimesCrossed++;
  }

  const finalQuote = quoteFullRangePool(amount, isToken1, fullRangePoolState);

  return {
    calculatedAmount: finalQuote.calculatedAmount,
    consumedAmount: finalQuote.consumedAmount,
    gasConsumed:
      BASE_GAS_COST_OF_ONE_TWAMM_SWAP +
      Number(currentTime > lastExecutionTime) *
        GAS_COST_OF_EXECUTING_VIRTUAL_ORDERS +
      virtualOrderDeltaTimesCrossed *
        GAS_COST_OF_CROSSING_ONE_VIRTUAL_ORDER_DELTA +
      approximateExtraDistinctTimeBitmapLookups(
        lastExecutionTime,
        currentTime,
      ) *
        GAS_COST_OF_ONE_COLD_SLOAD,
    skipAhead: finalQuote.skipAhead,
  };
}

interface VirtualOrdersExecutedEvent {
  token0SaleRate: bigint;
  token1SaleRate: bigint;
}

function parseVirtualOrdersExecutedEvent(
  data: string,
): VirtualOrdersExecutedEvent {
  let n = BigInt(data);

  const token1SaleRate = BigInt.asUintN(112, n);
  n >>= 112n;

  const token0SaleRate = BigInt.asUintN(112, n);

  return {
    token0SaleRate,
    token1SaleRate,
  };
}

export namespace TwammPoolState {
  export type SaleRateDelta = TimedPoolState.TimeRateDelta;

  export interface Object {
    fullRangePoolState: FullRangePoolState.Object;
    timedPoolState: TimedPoolState.Object;
  }

  export function fromPoolInitialization(
    state: PoolInitializationState,
  ): DeepReadonly<Object> {
    return {
      fullRangePoolState: FullRangePoolState.fromPoolInitialization(state),
      timedPoolState: {
        token0Rate: 0n,
        token1Rate: 0n,
        lastTime: BigInt(state.blockHeader.timestamp),
        virtualDeltas: [],
      },
    };
  }

  export function fromQuoter(data: TwammQuoteData): DeepReadonly<Object> {
    const liquidity = data.liquidity.toBigInt();
    const sqrtRatioFloat = data.sqrtRatio.toBigInt();

    return {
      fullRangePoolState: {
        sqrtRatio: floatSqrtRatioToFixed(sqrtRatioFloat),
        liquidity,
      },
      timedPoolState: TimedPoolState.fromQuoter(
        data.saleRateToken0.toBigInt(),
        data.saleRateToken1.toBigInt(),
        data.lastVirtualOrderExecutionTime.toBigInt(),
        data.saleRateDeltas.map(srd => ({
          time: srd.time.toBigInt(),
          delta0: srd.saleRateDelta0.toBigInt(),
          delta1: srd.saleRateDelta1.toBigInt(),
        })),
      ),
    };
  }

  export function fromSwappedEvent(
    oldState: DeepReadonly<Object>,
    ev: SwappedEvent,
  ): Object {
    const clonedState = structuredClone(oldState) as DeepWritable<
      typeof oldState
    >;

    clonedState.fullRangePoolState.liquidity = ev.liquidityAfter;
    clonedState.fullRangePoolState.sqrtRatio = ev.sqrtRatioAfter;

    return clonedState;
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

    clonedState.fullRangePoolState.liquidity += liquidityDelta;

    return clonedState;
  }

  export function fromVirtualOrdersExecutedEvent(
    oldState: DeepReadonly<Object>,
    ev: VirtualOrdersExecutedEvent,
    timestamp: bigint,
  ): Object {
    const clonedState = structuredClone(oldState) as DeepWritable<
      typeof oldState
    >;

    const timed = clonedState.timedPoolState;

    timed.lastTime = timestamp;
    timed.token0Rate = ev.token0SaleRate;
    timed.token1Rate = ev.token1SaleRate;

    TimedPoolState.pruneDeltasAtOrBefore(timed.virtualDeltas, timestamp);

    return clonedState;
  }

  export function fromOrderUpdatedEvent(
    oldState: DeepReadonly<Object>,
    [startTime, endTime]: [bigint, bigint],
    orderSaleRateDelta: bigint,
    isToken1: boolean,
  ): Object | null {
    if (orderSaleRateDelta === 0n) {
      return null;
    }

    const clonedState = structuredClone(oldState) as DeepWritable<
      typeof oldState
    >;

    TimedPoolState.applyRateDeltaBoundaries(clonedState.timedPoolState, [
      [
        startTime,
        isToken1 ? 0n : orderSaleRateDelta,
        isToken1 ? orderSaleRateDelta : 0n,
      ],
      [
        endTime,
        isToken1 ? 0n : -orderSaleRateDelta,
        isToken1 ? -orderSaleRateDelta : 0n,
      ],
    ]);

    return clonedState;
  }
}
