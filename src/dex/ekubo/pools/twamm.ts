import _ from 'lodash';
import { Logger } from 'log4js';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { EkuboContracts, TwammQuoteData } from '../types';
import {
  FullRangePoolState,
  quote as quoteFullRangePoolUnbound,
} from './full-range';
import { EkuboPool, NamedEventHandlers, PoolKeyed, Quote } from './iface';
import { MAX_U32 } from './math/constants';
import { floatSqrtRatioToFixed } from './math/price';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './math/tick';
import { calculateNextSqrtRatio } from './math/twamm/sqrt-ratio';
import { parseSwappedEvent, PoolKey, SwappedEvent } from './utils';

const SLOT_DURATION_SECS = 12;

const GAS_COST_OF_ONE_VIRTUAL_ORDER_DELTA = 25_000;
const GAS_COST_OF_EXECUTING_VIRTUAL_ORDERS = 15_000;

export class TwammPool extends EkuboPool<TwammPoolState.Object> {
  private readonly dataFetcher;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    key: PoolKey,
  ) {
    const {
      contract: { address: coreAddress },
      interface: coreIface,
    } = contracts.core;
    const {
      contract: { address: twammAddress },
      interface: twammIface,
      dataFetcher,
    } = contracts.twamm;

    super(
      parentName,
      dexHelper,
      logger,
      key,
      {
        [coreAddress]: new NamedEventHandlers(coreIface, {
          PositionUpdated: (args, oldState) => {
            if (key.num_id !== BigInt(args.poolId)) {
              return null;
            }

            return TwammPoolState.fromPositionUpdatedEvent(
              oldState,
              args.params.liquidityDelta.toBigInt(),
            );
          },
        }),
        [twammAddress]: new NamedEventHandlers(twammIface, {
          OrderUpdated: (args, oldState) => {
            const orderKey = args.orderKey;
            const [sellToken, buyToken] = [
              BigInt(orderKey.sellToken),
              BigInt(orderKey.buyToken),
            ];
            const [token0, token1] = [sellToken, buyToken].sort();

            if (
              key.token0 !== token0 ||
              key.token1 !== token1 ||
              key.config.fee !== orderKey.fee.toBigInt()
            ) {
              return null;
            }

            return TwammPoolState.fromOrderUpdatedEvent(
              oldState,
              [orderKey.startTime.toNumber(), orderKey.endTime.toNumber()],
              args.saleRateDelta.toBigInt(),
              sellToken === token1,
            );
          },
        }),
      },
      {
        [coreAddress]: (data, oldState) => {
          const ev = parseSwappedEvent(data);

          if (key.num_id !== ev.poolId) {
            return null;
          }

          return TwammPoolState.fromSwappedEvent(oldState, ev);
        },
        [twammAddress]: (data, oldState, blockHeader) => {
          const ev = parseVirtualOrdersExecutedEvent(data);

          if (key.num_id !== ev.poolId) {
            return null;
          }

          return TwammPoolState.fromVirtualOrdersExecutedEvent(
            oldState,
            ev,
            Number(blockHeader.timestamp),
          );
        },
      },
      quote,
    );

    this.dataFetcher = dataFetcher;
  }

  public async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<TwammPoolState.Object>> {
    const quoteData = await this.dataFetcher.getPoolState(this.key.toAbi(), {
      blockTag: blockNumber,
    });

    return TwammPoolState.fromQuoter(quoteData);
  }
}

interface VirtualOrdersExecutedEvent {
  poolId: bigint;
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
  n >>= 112n;

  const poolId = n;

  return {
    poolId,
    token0SaleRate,
    token1SaleRate,
  };
}

export namespace TwammPoolState {
  export interface SaleRateDelta {
    time: number;
    saleRateDelta0: bigint;
    saleRateDelta1: bigint;
  }

  // Needs to be serializiable, therefore can't make it a class
  export interface Object {
    fullRangePoolState: FullRangePoolState.Object;
    token0SaleRate: bigint;
    token1SaleRate: bigint;
    lastExecutionTime: number;
    virtualOrderDeltas: SaleRateDelta[];
  }

  export function fromQuoter(data: TwammQuoteData): DeepReadonly<Object> {
    const liquidity = data.liquidity.toBigInt();
    const sqrtRatioFloat = data.sqrtRatio.toBigInt();

    return {
      fullRangePoolState: {
        sqrtRatio: floatSqrtRatioToFixed(sqrtRatioFloat),
        liquidity,
      },
      token0SaleRate: data.saleRateToken0.toBigInt(),
      token1SaleRate: data.saleRateToken1.toBigInt(),
      lastExecutionTime: data.lastVirtualOrderExecutionTime.toNumber(),
      virtualOrderDeltas: data.saleRateDeltas.map(srd => ({
        time: srd.time.toNumber(),
        saleRateDelta0: srd.saleRateDelta0.toBigInt(),
        saleRateDelta1: srd.saleRateDelta1.toBigInt(),
      })),
    };
  }

  export function fromPositionUpdatedEvent(
    oldState: DeepReadonly<Object>,
    liquidityDelta: bigint,
  ): Object | null {
    if (liquidityDelta === 0n) {
      return null;
    }

    const clonedState = _.cloneDeep(oldState) as DeepWritable<typeof oldState>;

    clonedState.fullRangePoolState.liquidity += liquidityDelta;

    return clonedState;
  }

  export function fromSwappedEvent(
    oldState: DeepReadonly<Object>,
    ev: SwappedEvent,
  ): Object {
    const clonedState = _.cloneDeep(oldState) as DeepWritable<typeof oldState>;

    clonedState.fullRangePoolState.liquidity = ev.liquidityAfter;
    clonedState.fullRangePoolState.sqrtRatio = ev.sqrtRatioAfter;

    return clonedState;
  }

  export function fromVirtualOrdersExecutedEvent(
    oldState: DeepReadonly<Object>,
    ev: VirtualOrdersExecutedEvent,
    timestamp: number,
  ): Object {
    const clonedState = _.cloneDeep(oldState) as DeepWritable<typeof oldState>;

    clonedState.lastExecutionTime = timestamp;
    clonedState.token0SaleRate = ev.token0SaleRate;
    clonedState.token1SaleRate = ev.token1SaleRate;

    const virtualOrderDeltas = clonedState.virtualOrderDeltas;

    for (
      let virtualOrder = virtualOrderDeltas[0];
      typeof virtualOrder !== 'undefined';
      virtualOrder = virtualOrderDeltas[0]
    ) {
      if (virtualOrder.time > timestamp) {
        break;
      }

      virtualOrderDeltas.shift();
    }

    return clonedState;
  }

  export function fromOrderUpdatedEvent(
    oldState: DeepReadonly<Object>,
    [startTime, endTime]: [number, number],
    orderSaleRateDelta: bigint,
    isToken1: boolean,
  ): Object {
    const clonedState = _.cloneDeep(oldState) as DeepWritable<typeof oldState>;

    const virtualOrderDeltas = clonedState.virtualOrderDeltas;
    let startIndex = 0;

    for (const [time, saleRateDelta] of [
      [startTime, orderSaleRateDelta],
      [endTime, -orderSaleRateDelta],
    ] as const) {
      if (time > clonedState.lastExecutionTime) {
        let idx = findOrderIndex(virtualOrderDeltas, time, startIndex);

        if (idx < 0) {
          idx = ~idx;
          virtualOrderDeltas.splice(idx, 0, {
            time,
            saleRateDelta0: 0n,
            saleRateDelta1: 0n,
          });
        }

        virtualOrderDeltas[idx][`saleRateDelta${isToken1 ? '1' : '0'}`] +=
          saleRateDelta;

        startIndex = idx + 1;
      } else {
        clonedState[`token${isToken1 ? '1' : '0'}SaleRate`] += saleRateDelta;
      }
    }

    return clonedState;
  }

  function findOrderIndex(
    virtualOrderDeltas: SaleRateDelta[],
    searchTime: number,
    startIndex = 0,
  ): number {
    let l = startIndex,
      r = virtualOrderDeltas.length - 1;

    while (l <= r) {
      const mid = Math.floor((l + r) / 2);
      const midOrderTime = virtualOrderDeltas[mid].time;

      if (midOrderTime === searchTime) {
        return mid;
      } else if (midOrderTime < searchTime) {
        l = mid + 1;
      } else {
        r = mid - 1;
      }
    }

    return ~l; // Bitwise NOT of the insertion point
  }
}

export function quote(
  this: PoolKeyed,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<TwammPoolState.Object>,
  overrideTime?: number,
): Quote {
  const currentTime =
    overrideTime ??
    Math.max(
      state.lastExecutionTime + SLOT_DURATION_SECS,
      Math.floor(Date.now() / 1000),
    );
  const fee = this.key.config.fee;
  const quoteFullRangePool = quoteFullRangePoolUnbound.bind(this);

  const liquidity = state.fullRangePoolState.liquidity;
  let nextSqrtRatio = state.fullRangePoolState.sqrtRatio;
  let token0SaleRate = state.token0SaleRate;
  let token1SaleRate = state.token1SaleRate;
  let lastExecutionTime = state.lastExecutionTime;

  let virtualOrderDeltaTimesCrossed = 0;
  let nextSaleRateDeltaIndex = state.virtualOrderDeltas.findIndex(
    srd => srd.time > lastExecutionTime,
  );

  let fullRangePoolState = state.fullRangePoolState;

  while (lastExecutionTime != currentTime) {
    const saleRateDelta = state.virtualOrderDeltas[nextSaleRateDeltaIndex];

    const nextExecutionTime = saleRateDelta
      ? Math.min(saleRateDelta.time, currentTime)
      : currentTime;

    const timeElapsed = nextExecutionTime - lastExecutionTime;
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
        fee,
      );

      const [amount, isToken1] =
        currentSqrtRatio < nextSqrtRatio ? [amount1, true] : [amount0, false];

      const quote = quoteFullRangePool(
        amount,
        isToken1,
        fullRangePoolState,
        nextSqrtRatio,
      );

      fullRangePoolState = quote.stateAfter;
    } else if (amount0 > 0n || amount1 > 0n) {
      const [amount, isToken1] =
        amount0 !== 0n ? [amount0, false] : [amount1, true];

      const quote = quoteFullRangePool(amount, isToken1, fullRangePoolState);

      fullRangePoolState = quote.stateAfter;

      nextSqrtRatio = quote.stateAfter.sqrtRatio;
    }

    if (saleRateDelta) {
      if (saleRateDelta.time === nextExecutionTime) {
        token0SaleRate += saleRateDelta.saleRateDelta0;
        token1SaleRate += saleRateDelta.saleRateDelta1;

        nextSaleRateDeltaIndex++;
        virtualOrderDeltaTimesCrossed++;
      }
    }

    lastExecutionTime = nextExecutionTime;
  }

  const finalQuote = quoteFullRangePool(amount, isToken1, fullRangePoolState);

  return {
    calculatedAmount: finalQuote.calculatedAmount,
    consumedAmount: finalQuote.consumedAmount,
    gasConsumed:
      finalQuote.gasConsumed +
      virtualOrderDeltaTimesCrossed * GAS_COST_OF_ONE_VIRTUAL_ORDER_DELTA +
      Number(currentTime > state.lastExecutionTime) *
        GAS_COST_OF_EXECUTING_VIRTUAL_ORDERS,
    skipAhead: finalQuote.skipAhead,
  };
}
