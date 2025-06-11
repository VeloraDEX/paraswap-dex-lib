import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import UsdcTransmuterAbi from '../../abi/usdc-transmuter/usdc-transmuter.abi.json';
import { erc20Iface } from '../../lib/tokens/utils';
import { Contract } from 'ethers';

export class UsdcTransmuterEventPool extends StatefulEventSubscriber<PoolState> {
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
    protected usdcTransmuterAddress: string,
    protected usdcAddress: string,
    protected usdcTransmuterIface = new Interface(UsdcTransmuterAbi),
    protected usdcContract = new Contract(
      usdcAddress,
      erc20Iface,
      dexHelper.provider,
    ),
  ) {
    super(parentName, 'usdc', dexHelper, logger);

    this.logDecoder = (log: Log) => this.usdcTransmuterIface.parseLog(log);
    this.addressesSubscribed = [usdcTransmuterAddress];

    this.handlers['Deposit'] = this.handleDeposit.bind(this);
    this.handlers['Withdraw'] = this.handleWithdrawal.bind(this);
  }

  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
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
    const balance = await this.usdcContract.balanceOf(
      this.usdcTransmuterAddress,
      { blockTag: blockNumber },
    );

    return {
      balance: balance.toBigInt(),
    };
  }

  async getOrGenerateState(blockNumber: number): Promise<PoolState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  handleDeposit(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    return {
      balance: state.balance + event.args.amount.toBigInt(),
    };
  }

  handleWithdrawal(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    return {
      balance: state.balance - event.args.amount.toBigInt(),
    };
  }
}
