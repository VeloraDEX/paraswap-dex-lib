import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { YNETHPoolState } from './type';
import { getOnChainStateYnETH } from './utils';

export class YnethPool extends StatefulEventSubscriber<YNETHPoolState> {
  decoder = (log: Log) => this.poolInterface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private poolInterface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'yneth', dexHelper, logger);
    this.addressesSubscribed = [poolAddress];
  }

  protected processLog(
    state: DeepReadonly<YNETHPoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<YNETHPoolState> | null> {
    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<YNETHPoolState>> {
    const state = await getOnChainStateYnETH(
      this.dexHelper.multiContract,
      this.poolAddress,
      this.poolInterface,
      blockNumber,
    );

    return state;
  }

  getPrice(blockNumber: number, ethAmount: bigint): bigint {
    const state = this.getState(blockNumber);
    if (!state) throw new Error('Cannot compute price');
    const { ynETHToETHRateFixed } = state;

    return ethAmount / ynETHToETHRateFixed;
  }
}
