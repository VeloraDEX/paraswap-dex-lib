import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { PoolState } from './types';
import { getOnChainState } from './utils';

export class UsualPool extends StatefulEventSubscriber<PoolState> {
  decoder = (log: Log) => this.poolInterface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private poolInterface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'UsualPool', dexHelper, logger);
    this.addressesSubscribed = [poolAddress];
  }

  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    try {
      const event = this.decoder(log);

      if (event.name === 'FloorPriceUpdated') {
        return {
          price: event.args.newFloorPrice.toBigInt(),
        };
      }

      return null;
    } catch (e) {
      this.logger.error('Failed to parse log', e);
      return null;
    }
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<PoolState>> {
    const state = await getOnChainState(
      this.dexHelper.multiContract,
      this.poolAddress,
      this.poolInterface,
      blockNumber,
    );
    return state;
  }

  async getPrice(blockNumber: number): Promise<bigint> {
    const state = await this.getOrGenerateState(blockNumber);
    if (!state) throw new Error('Cannot compute state');
    return state.price;
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolState> | null> {
    const state = this.getState(blockNumber);
    if (state) {
      return state;
    }

    this.logger.debug(
      `No state found for ${this.addressesSubscribed[0]}, generating new one`,
    );
    const newState = await this.generateState(blockNumber);

    if (!newState) {
      this.logger.debug(
        `Could not regenerate state for ${this.addressesSubscribed[0]}`,
      );
      return null;
    }
    this.setState(newState, blockNumber);
    return newState;
  }
}
