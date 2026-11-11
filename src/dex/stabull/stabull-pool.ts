import { getTopicLogDecoder } from '../../lib/topic-log-decoder';
import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { BlockHeader } from 'web3-eth';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { ChainLinkSubscriber } from '../../lib/chainlink';
import { erc20Iface } from '../../lib/tokens/utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Address, Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { PoolConfig, PoolState, TokenState } from './types';
import { assimilatorInterface, configInterface, poolInterface } from './abi';

// Normalize ethers return values to bigint for exact state updates.
const asBigInt = (value: any): bigint => BigInt(value.toString());
// Store addresses in one form so event matching is case-insensitive.
const asAddress = (value: any): string => value.toLowerCase();

// Build a multicall entry and decode its result with the matching ABI.
function call<T>(
  iface: Interface,
  target: string,
  functionName: string,
  args: unknown[] = [],
): MultiCallParams<T> {
  return {
    target,
    callData: iface.encodeFunctionData(functionName, args),
    decodeFunction: input => {
      const data =
        typeof input === 'string'
          ? input
          : 'returnData' in input
          ? input.returnData
          : input;
      return iface.decodeFunctionResult(functionName, data) as unknown as T;
    },
  };
}

export class StabullEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  readonly poolAddress: Address;
  readonly configAddress: Address;
  readonly poolConfig: PoolConfig;
  private activeOracleState: DeepReadonly<PoolState>['tokens'] | null = null;
  private recoveryBlockNumber: number | null = null;

  // Bind this subscriber to a pool and the dependencies discovered at startup.
  constructor(
    parentName: string,
    poolConfig: PoolConfig,
    dexHelper: IDexHelper,
    logger: Logger,
    configAddress: string,
    mapKey: string,
  ) {
    const poolAddress = poolConfig.address.toLowerCase();
    super(parentName, poolAddress, dexHelper, logger, true, mapKey);
    this.poolConfig = {
      ...poolConfig,
      address: poolAddress,
      tokens: poolConfig.tokens.map(asAddress) as [string, string],
    };
    this.poolAddress = poolAddress;
    this.configAddress = configAddress.toLowerCase();
    this.addressesSubscribed = [
      poolAddress,
      ...this.poolConfig.tokens,
      this.configAddress,
    ];

    this.logDecoder = (log: Log) => {
      const address = log.address.toLowerCase();
      const topic = log.topics[0];
      let iface: Interface | null = null;

      if (
        address === this.configAddress &&
        topic === configInterface.getEventTopic('GlobalFrozenSet')
      ) {
        iface = configInterface;
      } else if (
        this.poolConfig.tokens.includes(address) &&
        topic === erc20Iface.getEventTopic('Transfer')
      ) {
        iface = erc20Iface;
      } else if (
        this.poolConfig.address === address &&
        [
          poolInterface.getEventTopic('FrozenSet'),
          poolInterface.getEventTopic('EmergencyAlarm'),
          poolInterface.getEventTopic('Trade'),
        ].includes(topic)
      ) {
        iface = poolInterface;
      } else if (
        this.isKnownAggregator(address) &&
        topic ===
          ChainLinkSubscriber.proxyInterface.getEventTopic('AnswerUpdated')
      ) {
        iface = ChainLinkSubscriber.proxyInterface;
      }

      return iface ? getTopicLogDecoder(iface).decode(log) : null;
    };

    this.handlers['Transfer'] = this.handleTransfer.bind(this);
    this.handlers['AnswerUpdated'] = this.handleAnswerUpdated.bind(this);
    this.handlers['FrozenSet'] = this.handleFrozenSet.bind(this);
    this.handlers['EmergencyAlarm'] = this.handleEmergencyAlarm.bind(this);
    this.handlers['GlobalFrozenSet'] = this.handleGlobalFrozenSet.bind(this);
    this.handlers['Trade'] = this.handleTrade.bind(this);
  }

  // Apply reserve transfers, oracle updates, and pool/configuration events.
  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    let event: any;
    try {
      event = this.logDecoder(log as Log);
    } catch (error) {
      catchParseLogError(error, this.logger);
      this.clearCurrentState(log.blockNumber, 'malformed_relevant_log');
      throw error;
    }
    if (!event || !(event.name in this.handlers)) return null;
    return this.handlers[event.name](event, state, log);
  }

  /** Regenerate a block-pinned snapshot, reusing dependencies after startup. */
  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<PoolState>> {
    if (blockNumber === 'latest') {
      blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();
    }
    const pool = this.poolAddress;
    const tokenAddresses = this.poolConfig.tokens;
    const initialCalls: MultiCallParams<any>[] = [
      call(poolInterface, pool, 'curve'),
      call(poolInterface, pool, 'frozen'),
      call(poolInterface, pool, 'emergency'),
      call(configInterface, this.configAddress, 'getGlobalFrozenState'),
      ...tokenAddresses.map(token =>
        call(erc20Iface, token, 'balanceOf', [pool]),
      ),
    ];
    const cachedTokens = this.activeOracleState;
    if (!cachedTokens) {
      initialCalls.push(
        ...tokenAddresses.map(token =>
          call(poolInterface, pool, 'assimilator', [token]),
        ),
        ...tokenAddresses.map((_, index) =>
          call(poolInterface, pool, 'reserves', [index]),
        ),
        ...tokenAddresses.map((_, index) =>
          call(poolInterface, pool, 'numeraires', [index]),
        ),
      );
    }
    const initial = await this.dexHelper.multiWrapper.aggregate<any>(
      initialCalls,
      blockNumber,
    );

    const [curve, frozen, emergency, globallyFrozen] = initial;
    const balanceOffset = 4;
    let metadata: Array<
      Pick<TokenState, 'assimilator' | 'proxy' | 'decimals' | 'oracleDecimals'>
    >;
    if (cachedTokens) {
      metadata = cachedTokens.map(
        ({ assimilator, proxy, decimals, oracleDecimals }) => ({
          assimilator,
          proxy,
          decimals,
          oracleDecimals,
        }),
      );
    } else {
      const assimilatorOffset = balanceOffset + tokenAddresses.length;
      const reserveOffset = assimilatorOffset + tokenAddresses.length;
      const numeraireOffset = reserveOffset + tokenAddresses.length;
      const assimilators = tokenAddresses.map((_, i) =>
        asAddress(initial[assimilatorOffset + i][0]),
      );
      const reserves = tokenAddresses.map((_, i) =>
        asAddress(initial[reserveOffset + i][0]),
      );
      const numeraires = tokenAddresses.map((_, i) =>
        asAddress(initial[numeraireOffset + i][0]),
      );
      if (
        reserves.some((reserve, i) => reserve !== tokenAddresses[i]) ||
        numeraires.some((numeraire, i) => numeraire !== tokenAddresses[i])
      ) {
        throw new Error(
          `${this.parentName}: ${pool}: configured tokens must match pool reserve and numeraire order`,
        );
      }
      const assimilatorResults =
        await this.dexHelper.multiWrapper.aggregate<any>(
          assimilators.flatMap(assimilator => [
            call(assimilatorInterface, assimilator, 'token'),
            call(assimilatorInterface, assimilator, 'oracle'),
            call(assimilatorInterface, assimilator, 'tokenDecimals'),
            call(assimilatorInterface, assimilator, 'oracleDecimals'),
          ]),
          blockNumber,
        );
      metadata = assimilators.map((assimilator, index) => {
        const offset = index * 4;
        if (
          asAddress(assimilatorResults[offset][0]) !== tokenAddresses[index]
        ) {
          throw new Error(
            `${this.parentName}: ${pool}: assimilator token does not match configured token`,
          );
        }
        return {
          assimilator,
          proxy: asAddress(assimilatorResults[offset + 1][0]),
          decimals: Number(assimilatorResults[offset + 2][0].toString()),
          oracleDecimals: Number(assimilatorResults[offset + 3][0].toString()),
        };
      });
    }

    // Reuse proxy reads when both assets share a feed.
    const proxies = Array.from(new Set(metadata.map(item => item.proxy)));
    const oracleCalls = proxies.flatMap(proxy => [
      ...(!cachedTokens
        ? [call(ChainLinkSubscriber.proxyInterface, proxy, 'aggregator')]
        : []),
      call(ChainLinkSubscriber.proxyInterface, proxy, 'latestRoundData'),
    ]);
    const oracleResults = await this.dexHelper.multiWrapper.aggregate<any>(
      oracleCalls,
      blockNumber,
    );
    const oracleByProxy = new Map<
      string,
      { aggregator: string; answer: bigint; updatedAt: bigint }
    >();
    proxies.forEach((proxy, index) => {
      const resultIndex = index * (cachedTokens ? 1 : 2);
      const aggregator = cachedTokens
        ? cachedTokens.find(token => token.proxy.toLowerCase() === proxy)!
            .aggregator
        : asAddress(oracleResults[resultIndex][0]);
      const roundData = oracleResults[resultIndex + (cachedTokens ? 0 : 1)];
      oracleByProxy.set(proxy, {
        aggregator,
        answer: asBigInt(roundData.answer ?? roundData[1]),
        updatedAt: asBigInt(roundData.updatedAt ?? roundData[3]),
      });
    });

    const tokens = tokenAddresses.map((address, index): TokenState => {
      const tokenMetadata = metadata[index];
      const oracle = oracleByProxy.get(tokenMetadata.proxy)!;
      return {
        address,
        decimals: tokenMetadata.decimals,
        assimilator: tokenMetadata.assimilator,
        proxy: tokenMetadata.proxy,
        aggregator: oracle.aggregator,
        oracleDecimals: tokenMetadata.oracleDecimals,
        balance: asBigInt(initial[balanceOffset + index][0]),
        answer: oracle.answer,
        updatedAt: oracle.updatedAt,
      };
    }) as [TokenState, TokenState];

    const generatedState: DeepReadonly<PoolState> = {
      tokens,
      parameters: {
        alpha: asBigInt(curve.alpha ?? curve[0]),
        beta: asBigInt(curve.beta ?? curve[1]),
        delta: asBigInt(curve.delta ?? curve[2]),
        epsilon: asBigInt(curve.epsilon ?? curve[3]),
        lambda: asBigInt(curve.lambda ?? curve[4]),
      },
      weights: this.poolConfig.weights,
      frozen: Boolean(frozen[0]),
      emergency: Boolean(emergency[0]),
      globallyFrozen: Boolean(globallyFrozen[0]),
    };
    return generatedState;
  }

  // Track token deposits and withdrawals using only transfers involving the pool.
  handleTransfer(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const tokenIndex = state.tokens.findIndex(
      token => token.address.toLowerCase() === log.address.toLowerCase(),
    );
    if (tokenIndex < 0) return null;
    const from = event.args.from.toLowerCase();
    const to = event.args.to.toLowerCase();
    if (from !== this.poolAddress && to !== this.poolAddress) return null;

    const value = asBigInt(event.args.value);
    const tokens = state.tokens.map(token => ({ ...token })) as [
      TokenState,
      TokenState,
    ];
    if (from === this.poolAddress && to !== this.poolAddress) {
      if (tokens[tokenIndex].balance < value) {
        this.clearCurrentState(log.blockNumber, 'reserve_transfer_underflow');
        throw new Error(
          `${this.parentName}: ${this.poolAddress}: reserve transfer exceeds tracked balance`,
        );
      }
      tokens[tokenIndex].balance -= value;
    } else if (to === this.poolAddress && from !== this.poolAddress) {
      tokens[tokenIndex].balance += value;
    }
    return { ...state, tokens };
  }

  // Update every asset that shares the aggregator which emitted this answer.
  handleAnswerUpdated(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> {
    const address = log.address.toLowerCase();
    const answer = asBigInt(event.args.current);
    const updatedAt = asBigInt(event.args.updatedAt);
    const tokens = state.tokens.map(token =>
      token.aggregator.toLowerCase() === address
        ? { ...token, answer, updatedAt }
        : { ...token },
    ) as [TokenState, TokenState];
    return { ...state, tokens };
  }

  // Apply a pool's frozen flag update.
  handleFrozenSet(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> {
    return { ...state, frozen: Boolean(event.args.isFrozen) };
  }

  // Apply a pool's emergency flag update.
  handleEmergencyAlarm(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> {
    return { ...state, emergency: Boolean(event.args.isEmergency) };
  }

  // Apply the factory configuration's global frozen flag update.
  handleGlobalFrozenSet(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> {
    return { ...state, globallyFrozen: Boolean(event.args.isFrozen) };
  }

  // Reserve changes come from ERC20 transfers, so Trade does not change state.
  handleTrade(
    _event: any,
    _state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): null {
    return null;
  }

  /**
   * Discover the active oracle emitters before StatefulEventSubscriber adds
   * this subscriber to the block manager. Passing the same pinned snapshot to
   * initialize also prevents a cached state from being paired with addresses
   * discovered at a different block.
   */
  async initialize(blockNumber: number): Promise<void> {
    if (this.isInitialized) {
      throw new Error(`${this.parentName}: ${this.name}: already initialized`);
    }
    const bootstrapState = await this.generateState(blockNumber);
    this.setOracleSubscriptions(bootstrapState);
    await super.initialize(blockNumber, { state: bootstrapState });
  }

  /** Apply logs in order, then refresh lossy parameter events once per block. */
  protected async processBlockLogs(
    state: DeepReadonly<PoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    let nextState: DeepReadonly<PoolState> | null = null;
    let parametersChanged = false;
    const parameterTopic = poolInterface.getEventTopic('ParametersSet');

    // The base subscriber regenerates a null current state at the first log's
    // block, but older history may still be selected as the log base. That
    // fresh snapshot is already end-of-block, so skip this block's logs.
    if (
      this.recoveryBlockNumber !== null &&
      blockHeader.number >= this.recoveryBlockNumber
    ) {
      this.recoveryBlockNumber = null;
      return null;
    }

    for (const log of logs) {
      if (
        log.address.toLowerCase() === this.poolAddress &&
        log.topics[0] === parameterTopic
      ) {
        this.decodeRelevantLog(poolInterface, log);
        parametersChanged = true;
        continue;
      }
      const updated = this.processLog(nextState ?? state, log);
      if (updated) nextState = updated;
    }

    if (parametersChanged) {
      // ParametersSet rounds event values. Fetch the raw fixed-point values
      // once for this pool and block, without regenerating reserves or feeds.
      let curve: any;
      try {
        [curve] = await this.dexHelper.multiWrapper.aggregate<any>(
          [call(poolInterface, this.poolAddress, 'curve')],
          blockHeader.number,
        );
      } catch (error) {
        this.clearCurrentState(
          blockHeader.number,
          'curve_parameter_refresh_failed',
        );
        throw error;
      }
      nextState = {
        ...(nextState ?? state),
        parameters: {
          alpha: asBigInt(curve.alpha ?? curve[0]),
          beta: asBigInt(curve.beta ?? curve[1]),
          delta: asBigInt(curve.delta ?? curve[2]),
          epsilon: asBigInt(curve.epsilon ?? curve[3]),
          lambda: asBigInt(curve.lambda ?? curve[4]),
        },
      };
    }
    return nextState;
  }

  // Parse a subscribed event and invalidate state if its payload is malformed.
  private decodeRelevantLog(iface: Interface, log: Readonly<Log>) {
    try {
      return getTopicLogDecoder(iface).decode(log);
    } catch (error) {
      this.clearCurrentState(log.blockNumber, 'malformed_relevant_log');
      throw error;
    }
  }

  // Mark the current snapshot unusable until an exact-block refresh succeeds.
  private clearCurrentState(blockNumber: number, reason: string): void {
    this.recoveryBlockNumber = blockNumber;
    this._setState(null, blockNumber, reason);
    this.invalidate();
  }

  // Hide inactive pools and require state at or after the requested block.
  getState(minBlockNumber: number): DeepReadonly<PoolState> | null {
    if (this.isInactive()) return null;
    return super.getState(minBlockNumber);
  }

  // Prevent stale cache reads from restoring state behind a recovery barrier.
  setState(
    state: DeepReadonly<PoolState>,
    blockNumber: number,
    reason?: string,
  ): void {
    // A null state schedules a slave cache lookup in the base class. Do not
    // let that asynchronous lookup put the pre-failure snapshot back while
    // the next log update is expected to regenerate an exact-block snapshot.
    if (this.recoveryBlockNumber !== null && reason === 'addBatchHGet') return;
    super.setState(state, blockNumber, reason);
  }

  // Clear recovery barriers that belonged to blocks removed by a reorg.
  rollback(blockNumber: number): void {
    // A failure barrier belongs to the chain containing that block. If the
    // chain rolls back below it, canonical logs at the replacement height must
    // be replayed from the restored pre-failure snapshot.
    if (
      this.recoveryBlockNumber !== null &&
      blockNumber < this.recoveryBlockNumber
    ) {
      this.recoveryBlockNumber = null;
    }
    super.rollback(blockNumber);
  }

  // Include the pool address in the base subscriber's cache identity.
  protected getPoolIdentifierData() {
    return { pool: this.poolAddress };
  }

  private setOracleSubscriptions(state: DeepReadonly<PoolState>): void {
    this.addressesSubscribed = Array.from(
      new Set([
        this.poolAddress,
        ...this.poolConfig.tokens,
        this.configAddress,
        ...state.tokens.map(token => token.aggregator.toLowerCase()),
      ]),
    );
    // Dependencies remain fixed for this subscriber's lifetime. A service
    // restart creates a new subscriber to pick up dependency replacements.
    this.activeOracleState = state.tokens;
  }

  // Accept oracle events only from the emitters subscribed during initialization.
  private isKnownAggregator(address: string): boolean {
    return Boolean(
      this.activeOracleState?.some(
        token => token.aggregator.toLowerCase() === address,
      ),
    );
  }
}
