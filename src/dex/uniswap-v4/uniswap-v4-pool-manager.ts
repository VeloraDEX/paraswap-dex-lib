import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import { DexParams, Pool, PoolManagerState, SubgraphPool } from './types';
import { Address, Log, Logger } from '../../types';
import UniswapV4StateViewABI from '../../abi/uniswap-v4/state-view.abi.json';
import UniswapV4PoolManagerABI from '../../abi/uniswap-v4/pool-manager.abi.json';
import { Interface } from 'ethers/lib/utils';
import { IDexHelper } from '../../dex-helper';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { LogDescription } from '@ethersproject/abi/lib.esm';
import { queryOnePageForAllAvailablePoolsFromSubgraph } from './subgraph';
import { isETHAddress } from '../../utils';
import { NULL_ADDRESS } from '../../constants';
import { POOL_CACHE_REFRESH_INTERVAL } from './constants';
import { FactoryState } from '../uniswap-v3/types';
import { UniswapV4Pool } from './uniswap-v4-pool';

export class UniswapV4PoolManager extends StatefulEventSubscriber<PoolManagerState> {
  handlers: {
    [event: string]: (event: any, log: Log) => AsyncOrSync<PoolManagerState>;
  } = {};

  private pools: SubgraphPool[] = [];

  private eventPools: Record<string, UniswapV4Pool | null> = {};

  logDecoder: (log: Log) => any;

  stateViewIface: Interface;

  poolManagerIface: Interface;

  private wethAddress: string;

  private poolsCacheKey = 'pools_cache';

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    private readonly network: number,
    private readonly config: DexParams,
    protected logger: Logger,
    mapKey: string = '',
  ) {
    super(
      parentName,
      `${parentName} PoolManager`,
      dexHelper,
      logger,
      false,
      mapKey,
    );

    this.stateViewIface = new Interface(UniswapV4StateViewABI);
    this.poolManagerIface = new Interface(UniswapV4PoolManagerABI);
    this.addressesSubscribed = [this.config.poolManager];

    this.wethAddress =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();

    this.logDecoder = (log: Log) => this.poolManagerIface.parseLog(log);

    // Add handlers
    this.handlers['Initialize'] = this.handleInitializeEvent.bind(this);
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<PoolManagerState>,
  ) {
    this.pools = await this.queryAllAvailablePools(blockNumber);
    return super.initialize(blockNumber, options);
  }

  generateState(): FactoryState {
    return {};
  }

  protected async processLog(
    _: DeepReadonly<FactoryState>,
    log: Readonly<Log>,
  ): Promise<FactoryState> {
    const event = this.logDecoder(log);
    if (event.name in this.handlers) {
      await this.handlers[event.name](event, log);
    }

    return {};
  }

  public async getEventPool(
    poolId: string,
    blockNumber: number,
  ): Promise<UniswapV4Pool | null> {
    const _poolId = poolId.toLowerCase();
    let eventPool = this.eventPools[_poolId];

    if (eventPool === null) return null; // non existing pool

    if (eventPool) {
      return eventPool;
    }

    const subgraphPool = this.pools.find(
      pool => pool.id.toLowerCase() === _poolId,
    );

    if (!subgraphPool) {
      this.eventPools[_poolId] = null;
      return null;
    }

    eventPool = new UniswapV4Pool(
      this.dexHelper,
      this.parentName,
      this.network,
      this.config,
      this.logger,
      this.mapKey,
      _poolId,
      subgraphPool.token0.address.toLowerCase(),
      subgraphPool.token1.address.toLowerCase(),
      subgraphPool.fee,
      subgraphPool.hooks,
      0n,
      subgraphPool.tick,
      subgraphPool.tickSpacing,
    );

    await eventPool.initialize(blockNumber);
    this.eventPools[_poolId] = eventPool;

    return this.eventPools[_poolId];
  }

  public getAvailablePoolsForPair(
    srcToken: Address,
    destToken: Address,
  ): Pool[] {
    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);

    const isWethSrc = srcToken.toLowerCase() === this.wethAddress;
    const isWethDest = destToken.toLowerCase() === this.wethAddress;

    const _src = isEthSrc ? NULL_ADDRESS : srcToken.toLowerCase();
    const _dest = isEthDest ? NULL_ADDRESS : destToken.toLowerCase();

    const matchesSrcToken = (poolToken: string): boolean => {
      return (
        poolToken === _src ||
        (isEthSrc && poolToken === this.wethAddress) ||
        (isWethSrc && poolToken === NULL_ADDRESS)
      );
    };

    const matchesDestToken = (poolToken: string): boolean => {
      return (
        poolToken === _dest ||
        (isEthDest && poolToken === this.wethAddress) ||
        (isWethDest && poolToken === NULL_ADDRESS)
      );
    };

    return this.pools
      .filter(pool => {
        const token0 = pool.token0.address;
        const token1 = pool.token1.address;

        return (
          (matchesSrcToken(token0) && matchesDestToken(token1)) ||
          (matchesSrcToken(token1) && matchesDestToken(token0))
        );
      })
      .sort(
        (a, b) =>
          parseFloat(b.volumeUSD || '0') - parseFloat(a.volumeUSD || '0'),
      )
      .map(pool => ({
        id: pool.id,
        key: {
          currency0: pool.token0.address,
          currency1: pool.token1.address,
          fee: pool.fee,
          tickSpacing: parseInt(pool.tickSpacing),
          hooks: pool.hooks,
        },
      }));
  }

  private async queryAllAvailablePools(
    blockNumber: number,
  ): Promise<SubgraphPool[]> {
    const cachedPools = await this.dexHelper.cache.getAndCacheLocally(
      this.parentName,
      this.network,
      this.poolsCacheKey,
      POOL_CACHE_REFRESH_INTERVAL,
    );

    if (cachedPools) {
      const pools = JSON.parse(cachedPools);
      return pools;
    }

    const defaultPerPageLimit = 1000;
    let pools: SubgraphPool[] = [];
    let curPage = 0;

    let currentSubgraphPools: SubgraphPool[] =
      await queryOnePageForAllAvailablePoolsFromSubgraph(
        this.dexHelper,
        this.logger,
        this.parentName,
        this.config.subgraphURL,
        blockNumber,
        curPage * defaultPerPageLimit,
        defaultPerPageLimit,
      );
    pools = pools.concat(currentSubgraphPools);

    while (currentSubgraphPools.length === defaultPerPageLimit) {
      curPage++;
      currentSubgraphPools = await queryOnePageForAllAvailablePoolsFromSubgraph(
        this.dexHelper,
        this.logger,
        this.parentName,
        this.config.subgraphURL,
        blockNumber,
        curPage * defaultPerPageLimit,
        defaultPerPageLimit,
      );

      pools = pools.concat(currentSubgraphPools);
    }

    if (this.config.skipPoolsWithUnconventionalFees) {
      pools = pools.filter(
        pool => !this.isPoolWithUnconventionalFees(pool.fee),
      );
    }

    this.dexHelper.cache.setexAndCacheLocally(
      this.parentName,
      this.network,
      this.poolsCacheKey,
      POOL_CACHE_REFRESH_INTERVAL,
      JSON.stringify(pools),
    );

    return pools;
  }

  async handleInitializeEvent(
    event: LogDescription,
    log: Log,
  ): Promise<PoolManagerState> {
    const id = event.args.id.toLowerCase();
    const currency0 = event.args.currency0;
    const currency1 = event.args.currency1;
    const fee = event.args.fee;
    const tickSpacing = parseInt(event.args.tickSpacing);
    const hooks = event.args.hooks;
    const sqrtPriceX96 = BigInt(event.args.sqrtPriceX96);
    const tick = parseInt(event.args.tick);

    if (hooks !== NULL_ADDRESS) {
      this.logger.warn(
        `Pool ${id} has hooks ${hooks}, which is not supported yet. Skipping.`,
      );
      return {};
    }

    if (
      this.config.skipPoolsWithUnconventionalFees &&
      this.isPoolWithUnconventionalFees(fee)
    ) {
      this.logger.warn(`Skipping pool ${id} with unconventional fees ${fee}.`);
      return {};
    }

    this.logger.info(
      `Initializing pool ${id} with fee ${fee} and tick spacing ${tickSpacing} on ${this.parentName} `,
    );

    this.pools.push({
      id,
      fee,
      hooks,
      token0: {
        address: currency0.toLowerCase(),
      },
      token1: {
        address: currency1.toLowerCase(),
      },
      tick: tick.toString(),
      tickSpacing: tickSpacing.toString(),
      ticks: [],
    });

    const eventPool = new UniswapV4Pool(
      this.dexHelper,
      this.parentName,
      this.network,
      this.config,
      this.logger,
      this.mapKey,
      id,
      currency0.toLowerCase(),
      currency1.toLowerCase(),
      fee,
      hooks,
      sqrtPriceX96,
      tick.toString(),
      tickSpacing.toString(),
    );
    await eventPool.initialize(log.blockNumber);

    this.eventPools[id] = eventPool;

    return {};
  }

  private isPoolWithUnconventionalFees(fee: string | number): boolean {
    return +fee % 100 !== 0;
  }
}
