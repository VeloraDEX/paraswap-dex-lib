import { Interface } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { SWETHPoolState } from './type';
import { getOnChainStateSwETH } from './utils';
import { BI_POWS } from '../../bigint-constants';

export class SwethPool extends StatefulEventSubscriber<SWETHPoolState> {
  decoder = (log: Log) => this.poolInterface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private poolInterface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'sweth', dexHelper, logger);
    this.addressesSubscribed = [poolAddress];
  }

  protected processLog(
    state: DeepReadonly<SWETHPoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<SWETHPoolState> | null> {
    const event = this.decoder(log);

    if (!event) return null;

    if (event.name === 'Reprice')
      return {
        swETHToETHRateFixed: BigInt(event.args.newSwETHToETHRate),
      };

    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<SWETHPoolState>> {
    const state = await getOnChainStateSwETH(
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
    const { swETHToETHRateFixed } = state;

    // calculation in contract are made with UD60x18 precision
    return (ethAmount * BI_POWS[18]) / swETHToETHRateFixed;
  }
}
