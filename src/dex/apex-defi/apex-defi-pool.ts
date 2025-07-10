import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Address, Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import ApexDefiPoolABI from '../../abi/apex-defi/ApexDefiPool.abi.json';

export class ApexDefiEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  readonly token0: Address;

  readonly token1: Address;

  private _poolAddress?: Address;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    token0: Address,
    token1: Address,
    poolAddress: Address,
    logger: Logger,
    protected apexDefiIface = new Interface(ApexDefiPoolABI),
  ) {
    super(parentName, poolAddress, dexHelper, logger);

    this.token0 = token0.toLowerCase();
    this.token1 = token1.toLowerCase();
    this._poolAddress = poolAddress.toLowerCase();
    this.logDecoder = (log: Log) => this.apexDefiIface.parseLog(log);
    this.addressesSubscribed = new Array<Address>(1).fill(poolAddress);

    // Add handlers
    this.handlers['Swap'] = this.handleSwap.bind(this);
  }

  get poolAddress() {
    // If the pool address is not set, compute it
    // ApexDefi pools are always in the format of WETH/token
    // If the token0 is WETH, then the pool address is the token1 address
    // Otherwise, the pool address is the token0 address
    if (this._poolAddress === undefined) {
      if (this.dexHelper.config.isWETH(this.token0)) {
        this._poolAddress = this.token1;
      } else {
        this._poolAddress = this.token0;
      }
    }

    return this._poolAddress;
  }

  set poolAddress(address: Address) {
    this._poolAddress = address.toLowerCase();
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
    // TODO: complete me!
    return {
      fee: 0,
      tradingFee: 0,
      reserve0: 0n,
      reserve1: 0n,
    };
  }

  // Its just a dummy example
  handleSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    return null;
  }
}
