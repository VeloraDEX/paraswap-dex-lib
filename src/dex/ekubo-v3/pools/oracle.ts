import { DeepReadonly } from 'ts-essentials';
import { FullRangePool, FullRangePoolState } from './full-range';
import { PoolKeyed, Quote } from './pool';
import { StableswapPoolTypeConfig } from './utils';

// This assumes a snapshot is always inserted
const GAS_COST_OF_ONE_ORACLE_SWAP = 23_828;

export class OraclePool extends FullRangePool {
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
    const quote = FullRangePool.prototype.quoteFullRange.call(
      this,
      amount,
      isToken1,
      state,
      sqrtRatioLimit,
    );

    quote.gasConsumed = GAS_COST_OF_ONE_ORACLE_SWAP;

    return quote;
  }
}
