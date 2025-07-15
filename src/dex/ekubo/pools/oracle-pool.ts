import { Contract } from 'ethers';
import { IDexHelper } from '../../../dex-helper';
import { Logger } from '../../../types';
import { BasePool, Quote } from './base-pool';
import { Interface } from '@ethersproject/abi';
import { PoolKey } from './pool-utils';

const GAS_COST_OF_UPDATING_ORACLE_SNAPSHOT = 15_000;

export class OraclePool extends BasePool {
  public constructor(
    parentName: string,
    network: number,
    dexHelper: IDexHelper,
    logger: Logger,
    coreIface: Interface,
    dataFetcher: Contract,
    key: PoolKey,
    core: Contract,
  ) {
    super(
      parentName,
      network,
      dexHelper,
      logger,
      coreIface,
      dataFetcher,
      key,
      core,
    );
  }

  public override quote(
    amount: bigint,
    token: bigint,
    blockNumber: number,
  ): Quote {
    let baseQuote = super.quote(amount, token, blockNumber);

    if (baseQuote.gasConsumed > 0n) {
      baseQuote.gasConsumed += GAS_COST_OF_UPDATING_ORACLE_SNAPSHOT;
    }

    return baseQuote;
  }
}
