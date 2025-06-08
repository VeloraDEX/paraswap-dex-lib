import _ from 'lodash';
import { Interface } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { ConcentratorArusdState } from './types';
import { BI_POWS } from '../../bigint-constants';
import { getOnChainState } from './utils';

export class ConcentratorArusdEvent extends StatefulEventSubscriber<ConcentratorArusdState> {
  decoder = (log: Log) => this.poolInterface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private poolInterface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'ConcentratorArusd', dexHelper, logger);
    this.addressesSubscribed = [poolAddress];
  }

  protected processLog(
    state: DeepReadonly<ConcentratorArusdState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<ConcentratorArusdState> | null> {
    const event = this.decoder(log);

    if (!event) return null;

    const _state: ConcentratorArusdState = _.cloneDeep(state);
    if (event.name === 'Deposit') {
      _state.totalSupply = (
        BigInt(_state.totalSupply) + BigInt(event.args.amountSyOut)
      ).toString();
      _state.totalAssets = (
        BigInt(_state.totalAssets) + BigInt(event.args.amountDeposited)
      ).toString();
      return _state;
    } else if (event.name === 'Redeem') {
      _state.totalSupply = (
        BigInt(_state.totalSupply) - BigInt(event.args.amountSyToRedeem)
      ).toString();
      _state.totalAssets = (
        BigInt(_state.totalAssets) - BigInt(event.args.amountTokenOut)
      ).toString();
      return _state;
    }
    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<ConcentratorArusdState>> {
    const state = await getOnChainState(
      this.dexHelper.multiContract,
      this.poolAddress,
      this.poolInterface,
      blockNumber,
    );
    return state;
  }

  async getPrice(
    blockNumber: number,
    ethAmount: bigint,
    is_deposit: boolean,
  ): Promise<bigint> {
    const state = await this.getOrGenerateState(blockNumber);
    if (!state) throw new Error('Cannot compute price');
    const { totalSupply, totalAssets } = state;
    const nav = (BigInt(totalAssets) * BI_POWS[18]) / BigInt(totalSupply);
    if (is_deposit) {
      return BigInt((ethAmount * BI_POWS[18]) / nav);
    }
    return BigInt((nav * ethAmount) / BI_POWS[18]);
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ConcentratorArusdState> | null> {
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
