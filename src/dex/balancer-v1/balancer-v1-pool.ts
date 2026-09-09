import BigNumber from 'bignumber.js';
import { Interface } from '@ethersproject/abi';
import { Contract } from 'web3-eth-contract';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger, Token } from '../../types';
import { SwapSide } from '../../constants';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState, PoolInfo, FractionAsString } from './types';
import { BN_POWS } from '../../bignumber-constants';
import { calcOutGivenIn, calcInGivenOut } from './balancer-v1-math';
import { generatePoolStates } from './utils';
import BalancerV1PoolABI from '../../abi/BalancerV1Pool.json';
import { getTopicLogDecoder } from '../../lib/topic-log-decoder';

function multiplyStringBy1e18ToBigInt(n: FractionAsString): bigint {
  return BigInt(new BigNumber(n).times(BN_POWS[18]).toFixed(0));
}

export class BalancerV1EventPool extends StatefulEventSubscriber<PoolState> {
  static readonly iface = new Interface(BalancerV1PoolABI);

  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  addressesSubscribed: string[];

  protected swapFee: bigint;
  protected totalWeight: bigint;
  protected tokenWeights: { [tokenAddress: string]: bigint };

  constructor(
    parentName: string,
    protected network: number,
    dexHelper: IDexHelper,
    logger: Logger,
    protected balancerMulticall: Contract,
    public readonly poolInfo: PoolInfo,
  ) {
    super(parentName, poolInfo.id, dexHelper, logger);

    this.addressesSubscribed = [poolInfo.id];

    this.handlers['LOG_JOIN'] = this.handleJoinPool.bind(this);
    this.handlers['LOG_EXIT'] = this.handleExitPool.bind(this);
    this.handlers['LOG_SWAP'] = this.handleSwap.bind(this);

    this.swapFee = multiplyStringBy1e18ToBigInt(poolInfo.swapFee);
    this.totalWeight = multiplyStringBy1e18ToBigInt(poolInfo.totalWeight);
    this.tokenWeights = {};
    for (const tokenInfo of poolInfo.tokens) {
      this.tokenWeights[tokenInfo.address] = multiplyStringBy1e18ToBigInt(
        tokenInfo.denormWeight,
      );
    }
  }

  checkBalance(
    srcToken: Token,
    destToken: Token,
    amount: bigint,
    side: SwapSide,
    blockNumber: number,
  ): boolean {
    const state = this.getState(blockNumber);
    if (!state)
      throw new Error(
        `${this.parentName}: missing state for pool ${this.poolInfo.id}`,
      );
    if (side === SwapSide.SELL) {
      return amount <= state.tokenBalances[srcToken.address] / 2n;
    } else {
      return amount <= state.tokenBalances[destToken.address] / 3n;
    }
  }

  estimatePoolTotalBalance(token: Token, blockNumber: number): bigint {
    const state = this.getState(blockNumber);
    if (!state)
      throw new Error(
        `${this.parentName}: missing state for pool ${this.poolInfo.id}`,
      );
    return (
      (state.tokenBalances[token.address] * this.totalWeight) /
      this.tokenWeights[token.address]
    );
  }

  calcPrices(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
  ): bigint[] {
    const state = this.getState(blockNumber);
    if (!state)
      throw new Error(
        `${this.parentName}: missing state for pool ${this.poolInfo.id}`,
      );

    const balanceIn = state.tokenBalances[srcToken.address];
    const balanceOut = state.tokenBalances[destToken.address];
    const weightIn = this.tokenWeights[srcToken.address];
    const weightOut = this.tokenWeights[destToken.address];
    const swapFee = this.swapFee;

    const maxAmount = side === SwapSide.SELL ? balanceIn / 2n : balanceOut / 3n;

    let loggedAlready = false; // To avoid spamming logs

    return amounts.map(amount => {
      if (amount > maxAmount) return 0n;
      try {
        return (side === SwapSide.SELL ? calcOutGivenIn : calcInGivenOut)(
          balanceIn,
          weightIn,
          balanceOut,
          weightOut,
          amount,
          swapFee,
        );
      } catch (e) {
        if (!loggedAlready) {
          this.logger.error(
            `Error calculating price for pool ${this.poolInfo.id}:`,
            e,
          );
          loggedAlready = true;
        }
        return 0n;
      }
    });
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
      const event = getTopicLogDecoder(BalancerV1EventPool.iface).decode(log);
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
    return (
      await generatePoolStates(
        [this.poolInfo],
        this.balancerMulticall,
        blockNumber,
      )
    )[0];
  }

  handleJoinPool(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const tokenIn = event.args.tokenIn.toLowerCase();
    const tokenAmountIn = BigInt(event.args.tokenAmountIn.toString());
    return {
      tokenBalances: {
        ...state.tokenBalances,
        [tokenIn]: state.tokenBalances[tokenIn] + tokenAmountIn,
      },
    };
  }

  handleExitPool(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const tokenOut = event.args.tokenOut.toLowerCase();
    const tokenAmountOut = BigInt(event.args.tokenAmountOut.toString());
    return {
      tokenBalances: {
        ...state.tokenBalances,
        [tokenOut]: state.tokenBalances[tokenOut] - tokenAmountOut,
      },
    };
  }

  handleSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const tokenIn = event.args.tokenIn.toLowerCase();
    const tokenAmountIn = BigInt(event.args.tokenAmountIn.toString());
    const tokenOut = event.args.tokenOut.toLowerCase();
    const tokenAmountOut = BigInt(event.args.tokenAmountOut.toString());
    return {
      tokenBalances: {
        ...state.tokenBalances,
        [tokenIn]: state.tokenBalances[tokenIn] + tokenAmountIn,
        [tokenOut]: state.tokenBalances[tokenOut] - tokenAmountOut,
      },
    };
  }
}
