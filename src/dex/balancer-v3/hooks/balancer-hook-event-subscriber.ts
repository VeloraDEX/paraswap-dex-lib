import { Interface } from '@ethersproject/abi';
import _ from 'lodash';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../../types';
import { catchParseLogError } from '../../../utils';
import { StatefulEventSubscriber } from '../../../stateful-event-subscriber';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { loadHooksConfig } from './loadHooksConfig';
import {
  DirectionalFee,
  DirectionalFeeConfig,
  DirectionalFeeHookState,
  getDirectionalFeeHookState,
} from './directionalFeeHook';
import directionalFeeHookAbi from '../../../abi/balancer-v3/directionalFeeHook.json';
import {
  getStableSurgeHookState,
  maxSurgeFeePercentageChangedEvent,
  StableSurge,
  StableSurgeConfig,
  StableSurgeHookState,
  thresholdSurgePercentageChangedEvent,
} from './stableSurgeHook';
import stableSurgeHookAbi from '../../../abi/balancer-v3/stableSurgeHook.json';
import { combineInterfaces } from '../utils';
import { AkronHookState, AkronConfig, Akron } from './akronHook';

// Add each supported hook state here
export type HookState =
  | DirectionalFeeHookState
  | StableSurgeHookState
  | AkronHookState;

export type HookStateMap = {
  [address: string]: HookState;
};

export type HookConfig = DirectionalFeeConfig | StableSurgeConfig | AkronConfig;

export type HooksConfigMap = {
  [hookAddress: string]: HookConfig;
};

/**
 * This will handle events/state for each supported hook contract. State is used during swap calculations.
 * Each hook should have its own implementation file for state typing, fetching state and handling events.
 */
export class BalancerEventHook extends StatefulEventSubscriber<HookStateMap> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<HookStateMap>,
      log: Readonly<Log>,
      logger: Logger,
    ) => DeepReadonly<HookStateMap> | null;
  } = {};

  interfaces: Interface[];
  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  hooksConfigMap: HooksConfigMap;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'Balancer_Hooks', dexHelper, logger);

    // Load supported hooks from config file
    this.hooksConfigMap = loadHooksConfig(network);

    // Add each hook ABI here
    this.interfaces = [
      new Interface(directionalFeeHookAbi),
      new Interface(stableSurgeHookAbi),
    ];
    this.logDecoder = (log: Log) =>
      combineInterfaces(this.interfaces).parseLog(log);

    // Subscribe to all hooks
    this.addressesSubscribed = Object.keys(this.hooksConfigMap);

    // StableSurgeHook events
    this.handlers['ThresholdSurgePercentageChanged'] =
      thresholdSurgePercentageChangedEvent.bind(this);
    this.handlers['MaxSurgeFeePercentageChanged'] =
      maxSurgeFeePercentageChangedEvent.bind(this);
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
    state: DeepReadonly<HookStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<HookStateMap> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log, this.logger);
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
  ): Promise<DeepReadonly<HookStateMap>> {
    // Only hooks that are supported will be called
    const hookState: HookStateMap = {};

    await Promise.all(
      Object.keys(this.hooksConfigMap).map(async hookAddress => {
        const hookConfig = this.hooksConfigMap[hookAddress];
        if (hookConfig.type === DirectionalFee.type) {
          hookState[hookAddress] = await getDirectionalFeeHookState();
        } else if (hookConfig.type === StableSurge.type) {
          hookState[hookAddress] = await getStableSurgeHookState(
            this.interfaces[1],
            hookAddress,
            hookConfig.factoryAddress,
            hookConfig.factoryDeploymentBlock,
            this.dexHelper,
            blockNumber,
          );
        } else if (hookConfig.type === Akron.type) {
          // this hook does not need to be updated by event subscriber. Values filled from pool at swap time
          hookState[hookAddress] = {
            weights: [],
            minimumSwapFeePercentage: 0n,
          };
        }
      }),
    );

    return hookState;
  }

  async updateHookState() {
    // Not all hooks need updated, only ones with settings/state that can't be handled by events
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    const currentState =
      (_.cloneDeep(this.getStaleState()) as HookStateMap) || {};

    await Promise.all(
      Object.keys(this.hooksConfigMap).map(async hookAddress => {
        const hookConfig = this.hooksConfigMap[hookAddress];
        // StableSurge can have new registered pools with associated hook state
        if (hookConfig.type === StableSurge.type) {
          currentState[hookAddress] = await getStableSurgeHookState(
            this.interfaces[1],
            hookAddress,
            hookConfig.factoryAddress,
            hookConfig.factoryDeploymentBlock,
            this.dexHelper,
            blockNumber,
          );
        }
      }),
    );

    this.setState(currentState, blockNumber);
  }
}
