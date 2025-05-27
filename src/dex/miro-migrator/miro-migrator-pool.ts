import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import ERC20ABI from '../../abi/erc20.json';
import { Contract } from 'ethers';

export class MiroMigratorEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected migratorAddress: string,
    protected xyzAddress: string,
    protected transferTopic: string,
    protected xyzInterface: Interface = new Interface(ERC20ABI),
    protected xyzContract: Contract = new Contract(
      xyzAddress,
      ERC20ABI,
      dexHelper.provider,
    ),
  ) {
    super(parentName, 'xyz', dexHelper, logger);
    this.logDecoder = (log: Log) => this.xyzInterface.parseLog(log);
    this.addressesSubscribed = [xyzAddress];
  }

  protected async processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    try {
      const event = this.logDecoder(log);

      if (
        log.topics[0] === this.transferTopic &&
        event.args.dst.toLowerCase() === this.migratorAddress.toLowerCase()
      ) {
        return this.handleTransferTo(event, state);
      }

      if (
        log.topics[0] === this.transferTopic &&
        event.args.src.toLowerCase() === this.migratorAddress.toLowerCase()
      ) {
        return this.handleTransferFrom(event, state);
      }

      return null;
    } catch (e) {
      catchParseLogError(e, this.logger);
      return null;
    }
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<PoolState>> {
    const balance = await this.xyzContract.balanceOf(this.migratorAddress, {
      blockTag: blockNumber,
    });

    return { balance: balance.toBigInt() };
  }

  async getOrGenerateState(blockNumber: number): Promise<PoolState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  async handleTransferTo(
    event: any,
    state: DeepReadonly<PoolState>,
  ): Promise<DeepReadonly<PoolState>> {
    return {
      balance: state.balance + BigInt(event.args.wad),
    };
  }

  async handleTransferFrom(
    event: any,
    state: DeepReadonly<PoolState>,
  ): Promise<DeepReadonly<PoolState>> {
    return {
      balance: state.balance - BigInt(event.args.wad),
    };
  }
}
