import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import {
  DexParams,
  Pool,
  PoolManagerState,
  SubgraphConnectorPool,
  SubgraphPool,
  PoolKey,
} from './types';
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
import {
  POOL_CACHE_REFRESH_INTERVAL,
  POOL_CACHE_STORE_INTERVAL,
} from './constants';
import { FactoryState } from '../uniswap-v3/types';
import { UniswapV4Pool } from './uniswap-v4-pool';
import { UniswapV4PoolsList } from './config';
import { PoolState, TickInfo } from './types';
import { BytesLike } from 'ethers/lib/utils';
import { MultiResult } from '../../lib/multi-wrapper';
import { extractSuccessAndValue } from '../../lib/decoders';
import { NumberAsString } from '@paraswap/core';
import UniswapV4StateMulticallABI from '../../abi/uniswap-v4/state-multicall.abi.json';
import {
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_TO_USE_BY_CHAIN,
} from './constants';
import { IBaseHook } from './hooks/types';

export class UniswapV4PoolManager extends StatefulEventSubscriber<PoolManagerState> {
  handlers: {
    [event: string]: (event: any, log: Log) => AsyncOrSync<PoolManagerState>;
  } = {};

  private pools: SubgraphPool[] = [];

  private eventPools: Record<string, UniswapV4Pool | null> = {};

  // Guards against concurrent getEventPool() calls for the same pool id.
  // Stores in-flight initialization promises so duplicate callers await
  // the same work instead of creating duplicate pool instances.
  private poolInitPromises: Record<string, Promise<UniswapV4Pool | null>> = {};

  logDecoder: (log: Log) => any;

  stateViewIface: Interface;

  poolManagerIface: Interface;

  stateMulticallIface: Interface;

  private wethAddress: string;

  private poolsCacheKey = 'pools_cache';
  private supportedHookAddresses: string[];
  private hookInstancesByAddress: Record<string, IBaseHook>;

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    private readonly network: number,
    private readonly config: DexParams,
    supportedHooks: IBaseHook[],
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
    this.stateMulticallIface = new Interface(UniswapV4StateMulticallABI);
    this.addressesSubscribed = [this.config.poolManager];

    this.wethAddress =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();

    this.logDecoder = (log: Log) => this.poolManagerIface.parseLog(log);

    this.hookInstancesByAddress = Object.fromEntries(
      supportedHooks.map(hook => [hook.address.toLowerCase(), hook]),
    );

    this.supportedHookAddresses = [
      NULL_ADDRESS, // always include pools without hooks
      ...Object.keys(this.hookInstancesByAddress),
    ];

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
    const eventPool = this.eventPools[_poolId];

    if (eventPool === null) return null; // non existing pool

    if (eventPool) {
      return eventPool;
    }

    // If another caller is already initializing this pool, await the same promise
    const existingPromise = this.poolInitPromises[_poolId];
    if (existingPromise) {
      return existingPromise;
    }

    const initPromise = this._initEventPool(_poolId, blockNumber);
    this.poolInitPromises[_poolId] = initPromise;

    try {
      return await initPromise;
    } finally {
      delete this.poolInitPromises[_poolId];
    }
  }

  private async _initEventPool(
    poolId: string,
    blockNumber: number,
  ): Promise<UniswapV4Pool | null> {
    const subgraphPool = this.pools.find(
      pool => pool.id.toLowerCase() === poolId,
    );

    if (!subgraphPool) {
      this.eventPools[poolId] = null;
      return null;
    }

    const poolKey: PoolKey = {
      currency0: subgraphPool.token0.address.toLowerCase(),
      currency1: subgraphPool.token1.address.toLowerCase(),
      fee: subgraphPool.fee,
      tickSpacing: parseInt(subgraphPool.tickSpacing),
      hooks: subgraphPool.hooks,
    };

    const eventPool = new UniswapV4Pool(
      this.dexHelper,
      this.parentName,
      this.network,
      this.config,
      this.logger,
      this.mapKey,
      poolId,
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.hooks,
      poolKey.tickSpacing.toString(),
      this.getHook(poolId, poolKey),
    );

    await eventPool.initialize(blockNumber);
    this.eventPools[poolId] = eventPool;

    return eventPool;
  }

  public async getAvailablePoolsForPair(
    srcToken: Address,
    destToken: Address,
    blockNumber: number,
  ): Promise<Pool[]> {
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
    const staticPoolsList = UniswapV4PoolsList[this.network];

    if (staticPoolsList) {
      return staticPoolsList.filter(pool =>
        this.isHookSupported(pool.hooks.toLowerCase()),
      );
    }

    const cachedPoolsRaw = await this.dexHelper.cache.getAndCacheLocally(
      this.parentName,
      this.network,
      this.poolsCacheKey,
      POOL_CACHE_REFRESH_INTERVAL,
    );

    let cachedPools: SubgraphPool[] = [];

    if (cachedPoolsRaw) {
      cachedPools = JSON.parse(cachedPoolsRaw);

      const poolsTTL = await this.dexHelper.cache.ttl(
        this.parentName,
        this.network,
        this.poolsCacheKey,
      );

      if (
        cachedPools.length &&
        poolsTTL > POOL_CACHE_STORE_INTERVAL - POOL_CACHE_REFRESH_INTERVAL
      ) {
        this.registerHookPools(cachedPools);
        return cachedPools;
      }

      this.logger.info(`Pools cache TTL is ${poolsTTL}, refreshing`);
    }

    let pools: SubgraphPool[] = [];

    try {
      const defaultPerPageLimit = 1000;
      const hooksToQuery = this.supportedHookAddresses;
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
          hooksToQuery,
        );
      pools = pools.concat(currentSubgraphPools);

      while (currentSubgraphPools.length === defaultPerPageLimit) {
        curPage++;
        currentSubgraphPools =
          await queryOnePageForAllAvailablePoolsFromSubgraph(
            this.dexHelper,
            this.logger,
            this.parentName,
            this.config.subgraphURL,
            blockNumber,
            curPage * defaultPerPageLimit,
            defaultPerPageLimit,
            hooksToQuery,
          );

        pools = pools.concat(currentSubgraphPools);
      }

      if (this.config.skipPoolsWithUnconventionalFees) {
        pools = pools.filter(
          pool => !this.isPoolWithUnconventionalFees(pool.fee),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to fetch pools from subgraph for ${this.parentName}: ${error}, using cached pools...`,
      );

      // cachedPools + already fetched pools
      pools = cachedPools.concat(
        pools.filter(p => !cachedPools.find(cp => cp.id === p.id)),
      );
    }

    // always refresh pools in cache, even when subgraph queries failed
    // so next time we can use previously cached pools
    this.dexHelper.cache.setexAndCacheLocally(
      this.parentName,
      this.network,
      this.poolsCacheKey,
      POOL_CACHE_STORE_INTERVAL,
      JSON.stringify(pools),
    );

    this.registerHookPools(pools);

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

    if (!this.isHookSupported(hooks.toLowerCase())) {
      this.logger.warn(
        `Pool ${id} has hooks ${hooks}, which is not supported yet. Skipping.`,
      );
      return {};
    }

    if (
      UniswapV4PoolsList[this.network] &&
      !UniswapV4PoolsList[this.network].some(p => p.id === id)
    ) {
      this.logger.warn(`Pool ${id} is not in the static pools list, skipping.`);
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
      tickSpacing: tickSpacing.toString(),
    });

    const poolKey: PoolKey = {
      currency0: currency0.toLowerCase(),
      currency1: currency1.toLowerCase(),
      fee: fee.toString(),
      tickSpacing,
      hooks,
    };

    const eventPool = new UniswapV4Pool(
      this.dexHelper,
      this.parentName,
      this.network,
      this.config,
      this.logger,
      this.mapKey,
      id,
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.hooks,
      poolKey.tickSpacing.toString(),
      this.getHook(id, poolKey),
    );
    await eventPool.initialize(log.blockNumber);

    this.eventPools[id] = eventPool;

    return {};
  }

  private isPoolWithUnconventionalFees(fee: string | number): boolean {
    return +fee % 100 !== 0;
  }

  private registerHookPools(pools: SubgraphPool[]) {
    for (const pool of pools) {
      const poolKey: PoolKey = {
        currency0: pool.token0.address.toLowerCase(),
        currency1: pool.token1.address.toLowerCase(),
        fee: pool.fee,
        tickSpacing: parseInt(pool.tickSpacing),
        hooks: pool.hooks,
      };

      this.getHook(pool.id, poolKey);
    }
  }

  private getHook(poolId: string, poolKey: PoolKey): IBaseHook | undefined {
    const hook = this.hookInstancesByAddress[poolKey.hooks.toLowerCase()];
    if (!hook) {
      return undefined;
    }

    hook.registerPool(poolId, poolKey);
    return hook;
  }

  private getBitmapRange() {
    const networkId = this.dexHelper.config.data.network;

    const tickBitMapToUse =
      TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
    const tickBitMapBuffer =
      TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;

    return tickBitMapToUse + tickBitMapBuffer;
  }

  async generateMultiplePoolStates(
    pools: SubgraphConnectorPool[],
    blockNumber: number,
  ): Promise<(PoolState | null)[]> {
    const poolStates: (PoolState | null)[] = [];

    if (pools.length === 0) {
      return [];
    }

    const multicallTargets = pools.map(pool => {
      const poolKey = {
        currency0: pool.token0.address,
        currency1: pool.token1.address,
        fee: pool.fee,
        tickSpacing: parseInt(pool.tickSpacing),
        hooks: pool.hooks,
      };

      const callData = this.stateMulticallIface.encodeFunctionData(
        'getFullStateWithRelativeBitmaps',
        [
          this.config.poolManager,
          poolKey,
          this.getBitmapRange(),
          this.getBitmapRange(),
        ],
      );

      return {
        target: this.config.stateMulticall,
        callData,
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
          const [, toDecode] = extractSuccessAndValue(result);
          return this.stateMulticallIface.decodeFunctionResult(
            'getFullStateWithRelativeBitmaps',
            toDecode,
          );
        },
      };
    });

    const results = await this.dexHelper.multiWrapper.tryAggregate<any>(
      false,
      multicallTargets,
      blockNumber,
      50, // state multicall is heavy, use smaller batches
      false,
    );

    pools.forEach((pool, index) => {
      try {
        const stateResult = results[index].returnData[0];

        const ticksResults: Record<NumberAsString, TickInfo> = {};
        stateResult.ticks.forEach((tick: any) => {
          if (tick.value.liquidityGross > 0n) {
            ticksResults[tick.index.toString()] = {
              liquidityGross: BigInt(tick.value.liquidityGross),
              liquidityNet: BigInt(tick.value.liquidityNet),
            };
          }
        });

        const tickBitMapResults: Record<NumberAsString, bigint> = {};
        stateResult.tickBitmap.forEach((bitmap: any) => {
          tickBitMapResults[bitmap.index.toString()] = BigInt(bitmap.value);
        });

        const poolState: PoolState = {
          id: pool.id,
          token0: pool.token0.address.toLowerCase(),
          token1: pool.token1.address.toLowerCase(),
          fee: pool.fee,
          hooks: pool.hooks,
          feeGrowthGlobal0X128: BigInt(stateResult.feeGrowthGlobal0X128),
          feeGrowthGlobal1X128: BigInt(stateResult.feeGrowthGlobal1X128),
          liquidity: BigInt(stateResult.liquidity),
          slot0: {
            sqrtPriceX96: BigInt(stateResult.slot0.sqrtPriceX96),
            tick: BigInt(stateResult.slot0.tick),
            protocolFee: BigInt(stateResult.slot0.protocolFee),
            lpFee: BigInt(stateResult.slot0.lpFee),
          },
          tickSpacing: parseInt(pool.tickSpacing),
          ticks: ticksResults,
          tickBitmap: tickBitMapResults,
          isValid: true,
        };

        poolStates.push(poolState);
      } catch (error) {
        this.logger.error(
          `Failed to generate state for pool ${pool.id}: ${error}`,
        );

        poolStates.push(null);
      }
    });

    return poolStates;
  }

  private isHookSupported(hook: string): boolean {
    return this.supportedHookAddresses.includes(hook.toLowerCase());
  }
}
