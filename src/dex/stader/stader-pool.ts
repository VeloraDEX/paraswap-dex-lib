import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { DeepReadonly } from 'ts-essentials';
import { catchParseLogError } from '../../utils';
import { ETHxPoolState } from './types';
import { getOnChainStateETHx } from './utils';
import { Interface } from 'ethers';

export class ETHxEventPool extends StatefulEventSubscriber<ETHxPoolState> {
  decoder = (log: Log) => this.poolInterface.parseLog(log);
  DECIMALS = 1000000000000000000n;
  addressesSubscribed: string[];

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private poolInterface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'ETHx', dexHelper, logger);
    this.addressesSubscribed = [poolAddress];
  }

  protected processLog(
    state: DeepReadonly<ETHxPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<ETHxPoolState> | null {
    try {
      const event = this.decoder(log);

      if (!event) return null;

      if (event.name === 'ExchangeRateUpdated') {
        const totalEth = BigInt(event.args.totalEth);
        const ethxSupply = BigInt(event.args.ethxSupply);
        return {
          totalETHBalance: totalEth,
          totalETHXSupply: ethxSupply,
        };
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ETHxPoolState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ETHxPoolState>> {
    const state = await getOnChainStateETHx(
      this.dexHelper.multiContract,
      this.poolAddress,
      this.poolInterface,
      blockNumber,
    );

    return state;
  }

  getPrice(state: ETHxPoolState, ethAmount: bigint): bigint {
    const { totalETHBalance, totalETHXSupply } = state;

    return (ethAmount * totalETHXSupply) / totalETHBalance;
  }
}
