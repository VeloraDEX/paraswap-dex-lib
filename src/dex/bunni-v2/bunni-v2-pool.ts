import { Interface } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { BlockHeader, Log, Logger } from '../../types';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams, PoolStateMap, SubgraphPool } from './types';
import { BunniV2Config } from './config';
import PoolManagerABI from '../../abi/bunni-v2/PoolManager.abi.json';
import { getPools, initializePoolState } from './utils';
import _ from 'lodash';

export class BunniV2EventPool extends StatefulEventSubscriber<PoolStateMap> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolStateMap>,
      log: Readonly<Log>,
      blockHeader: BlockHeader,
    ) => AsyncOrSync<DeepReadonly<PoolStateMap> | null>;
  } = {};

  config: DexParams;
  poolManagerInterface: Interface;
  addressesSubscribed: string[];
  subgraphURL: string;

  logDecoder: (log: Log) => any;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(
      parentName,
      BunniV2Config.BunniV2[network].poolManager,
      dexHelper,
      logger,
    );

    this.config = BunniV2Config.BunniV2[network];
    this.poolManagerInterface = new Interface(PoolManagerABI);
    this.addressesSubscribed = [this.config.poolManager];
    this.subgraphURL = this.config.subgraphURL;

    this.logDecoder = (log: Log) => this.poolManagerInterface.parseLog(log);
    this.handlers['Initialize'] = this.handleInitializeEvent.bind(this);
  }

  protected async processLog(
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<PoolStateMap> | null> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log, blockHeader);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolStateMap>> {
    let poolStateMap = Object.create({}) as PoolStateMap;

    const pools: SubgraphPool[] = await getPools(
      this.dexHelper,
      this.logger,
      this.subgraphURL,
      blockNumber,
    );

    pools.forEach(pool => {
      poolStateMap[pool.id.toLowerCase()] = initializePoolState(
        pool.id,
        pool.currency0.id,
        pool.currency1.id,
        bigIntify(pool.fee),
        bigIntify(pool.tickSpacing),
        pool.hooks,
      );
    });

    return poolStateMap;
  }

  async handleInitializeEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<PoolStateMap> | null> {
    const newState = _.cloneDeep(state) as PoolStateMap;

    // decode the event args
    const poolId = event.args.id.toLowerCase();
    const currency0 = event.args.currency0.toLowerCase();
    const currency1 = event.args.currency1.toLowerCase();
    const fee = bigIntify(event.args.fee);
    const tickSpacing = bigIntify(event.args.tickSpacing);
    const hooks = event.args.hooks.toLowerCase();

    if (
      this.config.bunniHooks.some(
        bunniHook => bunniHook.toLowerCase() === hooks,
      )
    ) {
      newState[poolId] = initializePoolState(
        poolId,
        currency0,
        currency1,
        fee,
        tickSpacing,
        hooks,
      );
    }

    return newState;
  }
}
