import _ from 'lodash';
import { DeepReadonly, DeepWritable } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import { BasicQuoteData, EkuboContracts } from '../types';
import {
  EkuboPool,
  NamedEventHandlers,
  PoolKeyed,
  Quote,
  QuoteFn,
} from './iface';
import { floatSqrtRatioToFixed } from './math/price';
import { computeStep, isPriceIncreasing } from './math/swap';
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from './math/tick';
import { parseSwappedEvent, PoolKey, SwappedEvent } from './utils';

const GAS_COST_OF_ONE_FULL_RANGE_SWAP = 20_000;

export class FullRangePool extends EkuboPool<FullRangePoolState.Object> {
  private readonly dataFetcher;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    key: PoolKey,
    quoteFn?: QuoteFn<FullRangePoolState.Object>,
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

            return FullRangePoolState.fromPositionUpdatedEvent(
              oldState,
              args.params.liquidityDelta.toBigInt(),
            );
          },
        }),
      },
      {
        [address]: data => {
          const ev = parseSwappedEvent(data);

          if (key.num_id !== ev.poolId) {
            return null;
          }

          return FullRangePoolState.fromSwappedEvent(ev);
        },
      },
      quoteFn ?? quote,
    );

    this.dataFetcher = dataFetcher;
  }

  public async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<FullRangePoolState.Object>> {
    const data = await this.dataFetcher.getQuoteData([this.key.toAbi()], 0, {
      blockTag: blockNumber,
    });
    return FullRangePoolState.fromQuoter(data[0]);
  }
}

export namespace FullRangePoolState {
  // Needs to be serializiable, therefore can't make it a class
  export type Object = {
    sqrtRatio: bigint;
    liquidity: bigint;
  };

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

    const clonedState = _.cloneDeep(oldState) as DeepWritable<typeof oldState>;

    clonedState.liquidity += liquidityDelta;

    return clonedState;
  }

  export function fromSwappedEvent(ev: SwappedEvent): Object {
    return {
      liquidity: ev.liquidityAfter,
      sqrtRatio: ev.sqrtRatioAfter,
    };
  }
}

export function quote(
  this: PoolKeyed,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<FullRangePoolState.Object>,
  sqrtRatioLimit?: bigint,
): Quote & { stateAfter: typeof state } {
  const isIncreasing = isPriceIncreasing(amount, isToken1);

  let sqrtRatio = state.sqrtRatio;
  const liquidity = state.liquidity;

  sqrtRatioLimit ??= isIncreasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;

  const step = computeStep({
    fee: this.key.config.fee,
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
