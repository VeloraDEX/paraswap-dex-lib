import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import StkGHO_ABI from '../../abi/stkGHO.json';
import { StkGHOConfig } from './config';
import { uint256ToBigInt } from '../../lib/decoders';

export class StkGHOEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly poolName: string,
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected stkGHOIface = new Interface(StkGHO_ABI),
  ) {
    super(parentName, poolName, dexHelper, logger);

    this.logDecoder = (log: Log) => this.stkGHOIface.parseLog(log);
    this.addressesSubscribed = [StkGHOConfig[parentName][network].stkGHO];

    this.handlers['ExchangeRateChanged'] =
      this.handleExchangeRateChanged.bind(this);
  }

  getIdentifier(): string {
    return `${this.parentName}`;
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
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

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const callData = [
      {
        target: this.addressesSubscribed[0],
        callData: this.stkGHOIface.encodeFunctionData('getExchangeRate', []),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const res = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      true,
      callData,
      blockNumber,
    );

    const result = {
      exchangeRate: res[0].returnData,
    };

    return result;
  }

  handleExchangeRateChanged(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    return {
      exchangeRate: BigInt(event.args.exchangeRate),
    };
  }
}
