import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import { erc20Iface } from '../../lib/tokens/utils';
import { uint256ToBigInt } from '../../lib/decoders';

export class StabullEventPool extends StatefulEventSubscriber<PoolState> {
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
    readonly poolAddress: string,
    protected addressesSubscribed_: string[],
    logger: Logger,
  ) {
    super(parentName, poolAddress.toLowerCase(), dexHelper, logger);

    this.logDecoder = (log: Log) => erc20Iface.parseLog(log);
    this.addressesSubscribed = addressesSubscribed_;
    this.poolAddress = poolAddress.toLowerCase();
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
    let calldata = [
      {
        target: this.addressesSubscribed[0],
        callData: erc20Iface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.addressesSubscribed[1],
        callData: erc20Iface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const data = await this.dexHelper.multiWrapper.tryAggregate(
      true,
      calldata,
      blockNumber,
    );

    return {
      reserves0: data[0].success ? data[0].returnData : 0n,
      reserves1: data[1].success ? data[1].returnData : 0n,
    };
  }

  /**
   * Handles a transfer event and updates the pool state accordingly.
   *
   * @param event - The transfer event object containing details about the transfer.
   * @param state - The current state of the pool.
   * @param log - The log object containing additional information about the event.
   * @returns The updated pool state if the transfer involves the pool, otherwise null.
   */
  handleTransfer(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const from = event.args.from.toLowerCase();
    const to = event.args.to.toLowerCase();

    // Check if pool is involved in the transfer
    if (from !== this.poolAddress && to !== this.poolAddress) {
      return null;
    }

    // Determine which token this is
    const eventTokenAddress = log.address.toLowerCase();
    const isToken0 =
      eventTokenAddress === this.addressesSubscribed[0].toLowerCase();

    const value: bigint = event.args.value.toBigInt();
    const reserveKey = isToken0 ? 'reserves0' : 'reserves1';
    const currentReserve = state[reserveKey];

    // Pool is sending tokens (decrease) or receiving tokens (increase)
    const isFromPool = from === this.poolAddress;
    const newReserve = isFromPool
      ? currentReserve - value
      : currentReserve + value;

    return {
      ...state,
      [reserveKey]: newReserve,
    };
  }
}
