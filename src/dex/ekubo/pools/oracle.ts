import { Logger } from 'log4js';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { EkuboContracts } from '../types';
import {
  FullRangePool,
  FullRangePoolState,
  quote as quoteFullRangePool,
} from './full-range';
import { IEkuboPool, Quote } from './iface';
import { PoolKey } from './utils';

const GAS_COST_OF_UPDATING_ORACLE_SNAPSHOT = 10_000;

export class OraclePool extends FullRangePool {
  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    key: PoolKey,
  ) {
    super(parentName, dexHelper, logger, contracts, key, quote);
  }
}

function quote(
  this: IEkuboPool,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<FullRangePoolState.Object>,
): Quote {
  const fullRangeQuote = quoteFullRangePool.bind(this)(amount, isToken1, state);

  if (fullRangeQuote.calculatedAmount !== 0n) {
    fullRangeQuote.gasConsumed += GAS_COST_OF_UPDATING_ORACLE_SNAPSHOT;
  }

  return fullRangeQuote;
}
