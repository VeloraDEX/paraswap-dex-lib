import { DeepReadonly } from 'ts-essentials';
import { Result } from '@ethersproject/abi';
import { FullRangePoolBase, FullRangePoolState } from './full-range';
import { PoolKeyed, Quote } from './pool';
import { StableswapPoolTypeConfig, SwappedEvent } from './utils';

// This assumes a snapshot is always inserted
const GAS_COST_OF_ONE_ORACLE_SWAP = 23_828;

export class OraclePool extends FullRangePoolBase<FullRangePoolState.Object> {
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

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<FullRangePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    return this.quoteOracle(amount, isToken1, state, sqrtRatioLimit);
  }

  public quoteOracle(
    this: PoolKeyed<StableswapPoolTypeConfig>,
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<FullRangePoolState.Object>,
    sqrtRatioLimit?: bigint,
  ): Quote {
    const quote = FullRangePoolBase.prototype.quoteFullRange.call(
      this,
      amount,
      isToken1,
      state,
      sqrtRatioLimit,
    );

    quote.gasConsumed = GAS_COST_OF_ONE_ORACLE_SWAP;

    return quote;
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
