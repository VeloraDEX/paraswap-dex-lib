import { Interface, Result } from '@ethersproject/abi';
import { Logger } from 'log4js';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../../stateful-event-subscriber';
import { BlockHeader, Log } from '../../../types';
import { PoolKey } from './utils';

export interface Quote {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  gasConsumed: number;
  skipAhead: number;
}

export interface PoolKeyed {
  key: PoolKey;
}

export interface IEkuboPool extends PoolKeyed {
  quote(amount: bigint, token: bigint, blockNumber: number): Quote;
}

export type QuoteFn<State> = (
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<State>,
) => Quote;

export type NamedEventHandler<State> = (
  args: Result,
  oldState: DeepReadonly<State>,
  blockHeader: Readonly<BlockHeader>,
) => DeepReadonly<State> | null;
export type AnonymousEventHandler<State> = (
  data: string,
  oldState: DeepReadonly<State>,
  blockHeader: Readonly<BlockHeader>,
) => DeepReadonly<State> | null;

export class NamedEventHandlers<State> {
  public constructor(
    private readonly iface: Interface,
    private readonly handlers: Record<string, NamedEventHandler<State>>,
  ) {}

  public parseLog(
    log: Readonly<Log>,
    oldState: DeepReadonly<State>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<State> | null {
    const event = this.iface.parseLog(log);
    return this.handlers[event.name]?.(event.args, oldState, blockHeader);
  }
}

const BASE_GAS_COST = 22_000;

export abstract class EkuboPool<State>
  extends StatefulEventSubscriber<State>
  implements IEkuboPool
{
  protected constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    public readonly key: PoolKey,
    private readonly namedEventHandlers: Record<
      string,
      NamedEventHandlers<State>
    >,
    private readonly anonymousEventHandlers: Record<
      string,
      AnonymousEventHandler<State>
    >,
    private readonly quoteFn: QuoteFn<State>,
  ) {
    super(parentName, key.string_id, dexHelper, logger);

    this.addressesSubscribed = [
      ...new Set(
        Object.keys(namedEventHandlers).concat(
          Object.keys(anonymousEventHandlers),
        ),
      ),
    ];
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
  protected override processLog(
    state: DeepReadonly<State>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<State> | null {
    const emitter = log.address;

    if (log.topics.length === 0) {
      return this.anonymousEventHandlers[emitter]?.(
        log.data,
        state,
        blockHeader,
      );
    }

    return this.namedEventHandlers[emitter]?.parseLog(log, state, blockHeader);
  }

  public quote(amount: bigint, token: bigint, blockNumber: number): Quote {
    const isToken1 = token === this.key.token1;

    if (!isToken1 && this.key.token0 !== token) {
      throw new Error('Invalid token');
    }

    if (amount === 0n) {
      return {
        consumedAmount: 0n,
        calculatedAmount: 0n,
        gasConsumed: 0,
        skipAhead: 0,
      };
    }

    const state = this.getState(blockNumber);
    if (state === null) {
      throw new Error(
        `Quote for block number ${blockNumber} requested but state is not recent enough`,
      );
    }

    const quote = this.quoteFn(amount, isToken1, state);

    if (quote.calculatedAmount !== 0n) {
      quote.gasConsumed += BASE_GAS_COST;
    }

    return quote;
  }
}
