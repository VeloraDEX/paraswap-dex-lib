import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger, Token } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { uint256ToBigInt } from '../../lib/decoders';
import { OSwapPool, OSwapPoolState } from './types';
import OSwapABI from '../../abi/oswap/oswap.abi.json';
import ERC20ABI from '../../abi/ERC20.abi.json';

export class OSwapEventPool extends StatefulEventSubscriber<OSwapPoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<OSwapPoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<OSwapPoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    readonly pool: OSwapPool,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected iOSwap = new Interface(OSwapABI),
    protected iERC20 = new Interface(ERC20ABI),
  ) {
    super(parentName, pool.id, dexHelper, logger);

    this.logDecoder = (log: Log) => this.parseLog(log);

    this.addressesSubscribed = [pool.address, pool.token0, pool.token1];
    this.handlers['TraderateChanged'] = this.handleTraderateChanged.bind(this);
    this.handlers['Transfer'] = this.handleTransfer.bind(this);
    this.handlers['RedeemRequested'] = this.handleRedeemRequested.bind(this);
    this.handlers['RedeemClaimed'] = this.handleRedeemClaimed.bind(this);
  }

  protected parseLog(log: Log) {
    if (log.address.toLowerCase() === this.pool.address) {
      return this.iOSwap.parseLog(log);
    }
    return this.iERC20.parseLog(log);
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
    state: DeepReadonly<OSwapPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<OSwapPoolState> | null {
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
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<OSwapPoolState>> {
    const callData: MultiCallParams<bigint>[] = [
      {
        target: this.pool.token0,
        callData: this.iERC20.encodeFunctionData('balanceOf', [
          this.pool.address,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.pool.token1,
        callData: this.iERC20.encodeFunctionData('balanceOf', [
          this.pool.address,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.pool.address,
        callData: this.iOSwap.encodeFunctionData('traderate0', []),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.pool.address,
        callData: this.iOSwap.encodeFunctionData('traderate1', []),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.pool.address,
        callData: this.iOSwap.encodeFunctionData('withdrawsQueued', []),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.pool.address,
        callData: this.iOSwap.encodeFunctionData('withdrawsClaimed', []),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const results = await this.dexHelper.multiWrapper.aggregate<bigint>(
      callData,
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
    );

    const [
      balance0,
      balance1,
      traderate0,
      traderate1,
      withdrawsQueued,
      withdrawsClaimed,
    ] = results;

    return {
      balance0: balance0.toString(),
      balance1: balance1.toString(),
      traderate0: traderate0.toString(),
      traderate1: traderate1.toString(),
      withdrawsQueued: withdrawsQueued.toString(),
      withdrawsClaimed: withdrawsClaimed.toString(),
    };
  }

  async getStateOrGenerate(
    blockNumber: number,
    readonly: boolean = true,
  ): Promise<OSwapPoolState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
  }

  /**
   * Handle a trade rate change on the pool.
   */
  handleTraderateChanged(
    event: any,
    state: DeepReadonly<OSwapPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<OSwapPoolState> | null {
    return {
      ...state,
      traderate0: event.args.traderate0.toString(),
      traderate1: event.args.traderate1.toString(),
    };
  }

  /**
   * Process the transfer events for tokens in/out of the pool
   * to keep the state's token balances up to date.
   */
  handleTransfer(
    event: any,
    state: DeepReadonly<OSwapPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<OSwapPoolState> | null {
    let balance0: bigint = BigInt(state.balance0);
    let balance1: bigint = BigInt(state.balance1);

    const tokenAddress = log.address.toLowerCase();
    const fromAddress = event.args.from.toLowerCase();
    const toAddress = event.args.to.toLowerCase();
    const amount = event.args.value.toBigInt();

    if (fromAddress == this.pool.address) {
      if (tokenAddress === this.pool.token0) {
        balance0 -= amount;
      } else if (tokenAddress === this.pool.token1) {
        balance1 -= amount;
      }
    }

    if (toAddress == this.pool.address) {
      if (tokenAddress === this.pool.token0) {
        balance0 += amount;
      } else if (tokenAddress === this.pool.token1) {
        balance1 += amount;
      }
    }

    return {
      ...state,
      balance0: balance0.toString(),
      balance1: balance1.toString(),
    };
  }

  handleRedeemRequested(
    event: any,
    state: DeepReadonly<OSwapPoolState>,
    log: Readonly<Log>,
  ) {
    return {
      ...state,
      withdrawsQueued: event.args.queued.toString(),
    };
  }

  handleRedeemClaimed(
    event: any,
    state: DeepReadonly<OSwapPoolState>,
    log: Readonly<Log>,
  ) {
    const withdrawsClaimed: bigint = BigInt(state.withdrawsClaimed);
    const assets: bigint = event.args.assets.toBigInt();

    return {
      ...state,
      withdrawsClaimed: (withdrawsClaimed + assets).toString(),
    };
  }
}
