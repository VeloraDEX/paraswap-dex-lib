import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import ERC20ABI from '../../abi/ERC20.abi.json';
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
    protected vlrTokenAddress: string,
    protected vlrContract: Contract = new Contract(
      vlrTokenAddress,
      ERC20ABI,
      dexHelper.provider,
    ),
  ) {
    super(parentName, 'vlr', dexHelper, logger);
    this.logDecoder = (log: Log) => this.vlrContract.interface.parseLog(log);
    this.addressesSubscribed = [vlrTokenAddress];

    this.handlers['Transfer'] = this.handleTransfer.bind(this);
  }

  protected async processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<PoolState>> {
    const balance = await this.vlrContract.balanceOf(this.migratorAddress, {
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

  handleTransfer(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const { from, to, value } = event.args;
    let balance = state.balance;

    if (to.toLowerCase() === this.migratorAddress.toLowerCase()) {
      balance += value.toBigInt();
    }
    if (from.toLowerCase() === this.migratorAddress.toLowerCase()) {
      balance -= value.toBigInt();
    }

    return { balance };
  }
}
