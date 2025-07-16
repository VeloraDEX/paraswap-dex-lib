import _ from 'lodash';
import { Interface, LogDescription } from 'ethers/lib/utils';
import { DeepReadonly } from 'ts-essentials';
import { Protocols } from '@airswap/constants';

import { Log, Logger, BlockHeader } from '../../types';
import { catchParseLogError } from '../../utils';
import {
  StatefulEventSubscriber,
  InitializeStateOptions,
} from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';

import { AirSwapRegistryState } from './types';
import { remove } from './utils';
import { AirSwapConfig } from './config';
import Registry from '@airswap/registry/build/contracts/Registry.sol/Registry.json';

const EMPTY_STATE: AirSwapRegistryState = {
  stakerServerURLs: {},
  protocolsByStaker: {},
  stakersByProtocol: {},
  tokensByStaker: {},
  stakersByToken: {},
};

/**
 * AirSwap Server URL Registry
 * Determines active server URLs by contract state and emitted events.
 */
export class AirSwapRegistry extends StatefulEventSubscriber<AirSwapRegistryState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<AirSwapRegistryState>,
      log: Readonly<Log>,
    ) => DeepReadonly<AirSwapRegistryState> | null;
  } = {};
  logDecoder: (log: Log) => any;
  registryInterface: Interface;
  addressesSubscribed: string[];
  updateCallback: Function | null = null;

  constructor(
    protected dexKey: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    protected logger: Logger,
    protected serverURLsOverride?: string[],
  ) {
    super(dexKey, 'REGISTRY', dexHelper, logger);
    this.registryInterface = new Interface(Registry.abi);
    this.addressesSubscribed = [AirSwapConfig.AirSwap[network].registryAddress];
    this.handlers['SetServerURL'] = this.handleSetServerURL.bind(this);
    this.handlers['AddProtocols'] = this.handleAddProtocols.bind(this);
    this.handlers['RemoveProtocols'] = this.handleRemoveProtocols.bind(this);
    this.handlers['UnsetServer'] = this.handleUnsetServer.bind(this);
    this.logDecoder = this.registryInterface.parseLog.bind(this);
  }

  /**
   * @name setUpdateCallback
   * @description Set a callback handler for URL updates
   * @param callback the callback function
   */
  setUpdateCallback(callback: Function) {
    this.updateCallback = callback;
  }

  /**
   * @name callUpdateCallback
   * @description Call the update callback handler
   */
  callUpdateCallback() {
    this.updateCallback && this.updateCallback(this.getServerURLs());
  }

  /**
   * @name getServerURLs
   * @description Get active URLs
   * @param tokenOne optional first token of a pair
   * @param tokenTwo optional second token of a pair
   */
  getServerURLs(tokenOne?: string, tokenTwo?: string): string[] {
    if (this.serverURLsOverride?.length) {
      return this.serverURLsOverride;
    }
    const stakers =
      this.state?.stakersByProtocol[Protocols.RequestForQuoteERC20] || [];
    return stakers
      ?.filter(staker => {
        if (tokenOne && !this.state?.stakersByToken[tokenOne].includes(staker))
          return false;
        if (tokenTwo && !this.state?.stakersByToken[tokenTwo].includes(staker))
          return false;
        return this.state?.stakerServerURLs[staker];
      })
      .map(staker => {
        return this.state?.stakerServerURLs[staker] || '';
      });
  }

  /**
   * @name initialize
   * @description Called by instantiator; calls on super
   * @param blockNumber block number to initialize for
   * @param options options for initial state
   */
  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<AirSwapRegistryState>,
  ) {
    await super.initialize(blockNumber, options);
  }

  /**
   * @name handleSetServerURL
   * @description handle SetServerURL contract event
   * @param event the event itself
   * @param state state to update
   */
  handleSetServerURL(
    event: LogDescription,
    state: DeepReadonly<AirSwapRegistryState>,
  ) {
    const staker = event.args[0];
    const url = event.args[1];
    const newState = _.cloneDeep(state) as AirSwapRegistryState;
    newState.stakerServerURLs[staker] = url;

    this.callUpdateCallback();
    return newState;
  }

  /**
   * @name handleAddProtocols
   * @description handle AddProtocols contract event
   * @param event the event itself
   * @param state state to update
   */
  handleAddProtocols(
    event: LogDescription,
    state: DeepReadonly<AirSwapRegistryState>,
  ) {
    const staker = event.args[0];
    const protocols = event.args[1];
    const newState = _.cloneDeep(state) as AirSwapRegistryState;

    // Emitted protocols are new so we can just push.
    protocols.forEach((protocol: string) => {
      newState.stakersByProtocol[protocol].push(staker);
      newState.protocolsByStaker[staker].push(protocol);
    });

    this.callUpdateCallback();
    return newState;
  }

  /**
   * @name handleRemoveProtocols
   * @description handle RemoveProtocols contract event
   * @param event the event itself
   * @param state state to update
   */
  handleRemoveProtocols(
    event: LogDescription,
    state: DeepReadonly<AirSwapRegistryState>,
  ) {
    const staker = event.args[0];
    const protocols = event.args[1];
    const newState = _.cloneDeep(state) as AirSwapRegistryState;

    protocols.forEach((protocol: string) => {
      newState.stakersByProtocol[protocol] = remove(
        newState.stakersByProtocol[protocol],
        staker,
      );
      newState.protocolsByStaker[staker] = remove(
        newState.protocolsByStaker[staker],
        protocol,
      );
    });

    this.callUpdateCallback();
    return newState;
  }

  /**
   * @name handleAddTokens
   * @description handle AddTokens contract event
   * @param event the event itself
   * @param state state to update
   */
  handleAddTokens(
    event: LogDescription,
    state: DeepReadonly<AirSwapRegistryState>,
  ) {
    const staker = event.args[0];
    const tokens = event.args[1];
    const newState = _.cloneDeep(state) as AirSwapRegistryState;

    // Emitted tokens are new so we can just push.
    tokens.forEach((token: string) => {
      newState.stakersByProtocol[token].push(staker);
      newState.tokensByStaker[staker].push(token);
    });
    return newState;
  }

  /**
   * @name handleRemoveTokens
   * @description handle RemoveTokens contract event
   * @param event the event itself
   * @param state state to update
   */
  handleRemoveTokens(
    event: LogDescription,
    state: DeepReadonly<AirSwapRegistryState>,
  ) {
    const staker = event.args[0];
    const tokens = event.args[1];
    const newState = _.cloneDeep(state) as AirSwapRegistryState;

    tokens.forEach((token: string) => {
      newState.stakersByToken[token] = remove(
        newState.stakersByToken[token],
        staker,
      );
      newState.tokensByStaker[staker] = remove(
        newState.tokensByStaker[staker],
        token,
      );
    });
    return newState;
  }

  /**
   * @name handleUnsetServer
   * @description handle UnsetServer contract event
   * @param event the event itself
   * @param state state to update
   */
  handleUnsetServer(
    event: LogDescription,
    state: DeepReadonly<AirSwapRegistryState>,
  ) {
    const staker = event.args[0];
    const protocols = event.args[2];
    const newState = _.cloneDeep(state) as AirSwapRegistryState;

    delete newState.stakerServerURLs[staker];
    delete newState.protocolsByStaker[staker];

    protocols.forEach((protocol: string) => {
      newState.stakersByProtocol[protocol] = remove(
        newState.stakersByProtocol[protocol],
        staker,
      );
    });

    this.callUpdateCallback();
    return newState;
  }

  /**
   * @name generateState
   * @description generate initial state from logs until a block
   * @param blockNumber block number to stop at
   */
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<AirSwapRegistryState>> {
    const logs = await this.dexHelper.provider.getLogs({
      address: AirSwapConfig.AirSwap[this.network].registryAddress,
      fromBlock: AirSwapConfig.AirSwap[this.network].registryBlock,
      toBlock: blockNumber,
    });
    let state: DeepReadonly<AirSwapRegistryState> = EMPTY_STATE;
    logs.forEach((log: Log) => {
      state = this.processLog(state, log) || state;
    });
    return state;
  }

  /**
   * @name processLog
   * @description process a log (event) emitted on the contract
   * @param state state to update
   * @param log actual log emitted
   */
  protected processLog(
    state: DeepReadonly<AirSwapRegistryState>,
    log: Readonly<Log>,
  ): DeepReadonly<AirSwapRegistryState> | null {
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
   * @name processBlockLogs
   * @description process the logs for a block
   * @param state state to update
   * @param logs logs emitted on the block
   * @param blockHeader the block
   */
  protected async processBlockLogs(
    state: DeepReadonly<AirSwapRegistryState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<AirSwapRegistryState> | null> {
    const _state = _.cloneDeep(state);
    let newState = await super.processBlockLogs(_state, logs, blockHeader);
    if (!newState) {
      this.logger.warn('received empty state generate new one');
      newState = await this.generateState(blockHeader.number);
    }

    return newState;
  }
}
