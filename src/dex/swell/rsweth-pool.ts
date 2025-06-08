import { Interface } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { RSWETHPoolState } from './type';
import { getOnChainStateRswETH } from './utils';
import { BI_POWS } from '../../bigint-constants';

export class RswethPool extends StatefulEventSubscriber<RSWETHPoolState> {
  decoder = (log: Log) => this.poolInterface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private poolInterface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'rsweth', dexHelper, logger);
    this.addressesSubscribed = [poolAddress];
  }

  protected processLog(
    state: DeepReadonly<RSWETHPoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<RSWETHPoolState> | null> {
    const event = this.decoder(log);

    if (!event) return null;

    if (event.name === 'Reprice')
      return {
        rswETHToETHRateFixed: BigInt(event.args.newRswETHToETHRate),
      };

    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<RSWETHPoolState>> {
    const state = await getOnChainStateRswETH(
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
    const { rswETHToETHRateFixed } = state;

    // calculation in contract are made with UD60x18 precision
    return (ethAmount * BI_POWS[18]) / rswETHToETHRateFixed;
  }
}
