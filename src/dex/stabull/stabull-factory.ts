import { getTopicLogDecoder } from '../../lib/topic-log-decoder';
import * as async from 'async';
import { DeepReadonly } from 'ts-essentials';
import { BlockHeader } from 'web3-eth';
import { Network, CACHE_PREFIX } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Log } from '../../types';
import { Utils } from '../../utils';
import { StabullConfig } from './config';
import { factoryInterface, poolInterface } from './abi';
import { StabullEventPool } from './stabull-pool';
import { PoolConfig } from './types';

const DISCOVERY_CHUNK_SIZE = 50_000;
const DISCOVERY_CONCURRENCY = 4;
const REGISTRY_TTL_SECONDS = 30 * 24 * 60 * 60;
const WEIGHT_SCALE = 10n ** 18n;
const ONE_64 = 1n << 64n;
const WEIGHT_ROUNDING = ONE_64 / WEIGHT_SCALE;

type RegistryState = {
  configAddress: string;
  throughBlock: number;
  blockHash: string;
  pools: PoolConfig[];
};

// Normalize addresses before comparing or caching them.
function lower(address: string): string {
  return address.toLowerCase();
}

// Parse cached numeric values without losing integer precision.
function asBigInt(value: unknown): bigint {
  return BigInt(String(value));
}

// Restore and normalize a cached factory registry, or reject malformed data.
function parseRegistry(value: string | null): RegistryState | null {
  if (!value) return null;
  try {
    const registry = Utils.Parse(value) as RegistryState;
    registry.configAddress = lower(registry.configAddress);
    registry.pools = registry.pools.map(pool => ({
      ...pool,
      address: lower(pool.address),
      tokens: pool.tokens.map(lower) as [string, string],
      weights: pool.weights.map(asBigInt) as [bigint, bigint],
    }));
    return registry;
  } catch (_error) {
    return null;
  }
}

// Unwrap multicall results before passing them to ethers decoders.
function rawResult(data: any): any {
  return typeof data === 'string'
    ? data
    : 'returnData' in data
    ? data.returnData
    : data;
}

export class StabullFactory extends StatefulEventSubscriber<RegistryState> {
  readonly pools = new Map<string, StabullEventPool>();
  private readonly registryCacheKey: string;
  private readonly factoryAddress: string;
  private readonly excludedPools: ReadonlySet<string>;
  private configAddress?: string;
  private rollbackEpoch = 0;
  private released = false;
  private readonly poolInitializations = new Map<string, Promise<void>>();

  constructor(
    private readonly network: Network,
    private readonly dexKey: string,
    dexHelper: IDexHelper,
  ) {
    const logger = dexHelper.getLogger(dexKey);
    const params = StabullConfig[dexKey][network];
    const factoryAddress = lower(params.factory);
    const root = `${CACHE_PREFIX}_${dexKey.toLowerCase()}_${Number(
      network,
    )}_${factoryAddress}`;
    // Preserve existing cache keys across the factory class rename.
    super(
      dexKey,
      `${dexKey}_pool_manager`,
      dexHelper,
      logger,
      false,
      `${root}_manager_state`,
    );
    this.factoryAddress = factoryAddress;
    this.registryCacheKey = `${root}_pool_registry`;
    this.addressesSubscribed = [factoryAddress];
    this.excludedPools = new Set((params.excludedPools ?? []).map(lower));
  }

  /**
   * Discovers the registry and starts one subscriber per pool. Each pool resolves
   * its assimilator and oracle dependencies here; recovery retains those mappings.
   */
  async initialize(blockNumber: number): Promise<void> {
    if (this.released) return;
    const epoch = this.rollbackEpoch;
    if (this.isInitialized) {
      await this.updatePools(blockNumber);
      return;
    }
    const params = StabullConfig[this.dexKey][this.network];
    const parsedCached = parseRegistry(
      await this.dexHelper.cache.getAndCacheLocally(
        this.dexKey,
        Number(this.network),
        this.registryCacheKey,
        REGISTRY_TTL_SECONDS,
      ),
    );
    const cached = parsedCached && {
      ...parsedCached,
      pools: parsedCached.pools.filter(pool => !this.isExcluded(pool.address)),
    };
    const configAddress = await this.getConfigAddress(blockNumber);
    this.configAddress = configAddress;
    const reusable =
      cached &&
      cached.configAddress === configAddress &&
      cached.throughBlock <= blockNumber &&
      (await this.isCanonical(cached));
    const initial: RegistryState = reusable
      ? cached
      : {
          configAddress,
          throughBlock: params.deploymentBlock - 1,
          blockHash: '',
          pools: [],
        };
    const fromBlock = Math.max(
      params.deploymentBlock,
      initial.throughBlock + 1,
    );
    let registry = initial;
    if (fromBlock <= blockNumber) {
      registry = {
        configAddress,
        throughBlock: blockNumber,
        blockHash: (await this.dexHelper.web3Provider.eth.getBlock(blockNumber))
          .hash,
        pools: this.mergePools(
          initial.pools,
          await this.discoverPools(fromBlock, blockNumber),
        ),
      };
    } else if (!reusable) {
      registry.blockHash = (
        await this.dexHelper.web3Provider.eth.getBlock(blockNumber)
      ).hash;
    }

    await async.mapLimit(
      [...registry.pools] as PoolConfig[],
      DISCOVERY_CONCURRENCY,
      async (pool: PoolConfig) => this.ensurePool(pool, blockNumber),
    );
    if (this.released || epoch !== this.rollbackEpoch) return;
    await this.writeRegistry(registry);
    if (this.released || epoch !== this.rollbackEpoch) return;
    await super.initialize(blockNumber, { state: registry });
  }

  // Ensure every registered pool has an active subscriber at this block.
  async updatePools(blockNumber: number): Promise<void> {
    if (this.released || !this.isInitialized) return;
    const registry = this.getStaleState();
    if (!registry) return;
    await async.mapLimit(
      [...registry.pools] as PoolConfig[],
      DISCOVERY_CONCURRENCY,
      async (pool: PoolConfig) => this.ensurePool(pool, blockNumber),
    );
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<RegistryState>> {
    if (this.released) throw new Error(`${this.dexKey}: factory is released`);
    const epoch = this.rollbackEpoch;
    const params = StabullConfig[this.dexKey][this.network];
    const block =
      blockNumber === 'latest'
        ? this.dexHelper.blockManager.getLatestBlockNumber()
        : blockNumber;
    // Regeneration rebuilds pool snapshots while retaining each pool's known
    // assimilator and oracle dependencies; mapping discovery happens at startup.
    const configAddress = await this.getConfigAddress(block);
    const pools = await this.discoverPools(params.deploymentBlock, block);
    const blockHash = (await this.dexHelper.web3Provider.eth.getBlock(block))
      .hash;
    if (this.released || epoch !== this.rollbackEpoch)
      throw new Error(`${this.dexKey}: state regeneration became stale`);
    this.configAddress = configAddress;
    await async.mapLimit(
      pools,
      DISCOVERY_CONCURRENCY,
      async (pool: PoolConfig) => this.ensurePool(pool, block),
    );
    if (this.released || epoch !== this.rollbackEpoch)
      throw new Error(`${this.dexKey}: state regeneration became stale`);
    const addresses = new Set(pools.map(pool => pool.address));
    for (const [address, pool] of this.pools) {
      if (!addresses.has(address)) {
        pool.invalidate();
        pool.inactivate();
        this.pools.delete(address);
      }
    }
    return { configAddress, throughBlock: block, blockHash, pools };
  }

  // Include active pool addresses in the base subscriber's cache identity.
  protected getPoolIdentifierData() {
    return { pools: [...this.pools.keys()] };
  }

  // Handle factory additions at block level so receipt reads can be asynchronous.
  protected processLog(
    _state: DeepReadonly<RegistryState>,
    _log: Readonly<Log>,
    _blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<RegistryState> | null {
    return null;
  }

  protected async processBlockLogs(
    state: DeepReadonly<RegistryState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<RegistryState> | null> {
    // Factory logs add pools incrementally; StatefulEventSubscriber handles
    // replay and rollback of this block-indexed registry around chain reorgs.
    if (this.released) return null;
    const epoch = this.rollbackEpoch;
    const additions: PoolConfig[] = [];
    for (const log of logs) {
      if (
        lower(log.address) !== this.factoryAddress ||
        log.topics[0] !== factoryInterface.getEventTopic('NewCurve')
      )
        continue;
      const address = lower(
        getTopicLogDecoder(factoryInterface).decode(log).args.curve,
      );
      if (
        state.pools.some(existing => existing.address === address) ||
        this.pools.has(address) ||
        additions.some(existing => existing.address === address)
      )
        continue;
      const pool = await this.readPool(address, log.transactionHash);
      if (this.released || epoch !== this.rollbackEpoch) return null;
      if (!pool) continue;
      await this.ensurePool(pool, blockHeader.number);
      if (this.released || epoch !== this.rollbackEpoch) return null;
      additions.push(pool);
    }
    if (additions.length === 0) return null;
    const next: RegistryState = {
      configAddress: state.configAddress,
      throughBlock: blockHeader.number,
      blockHash: blockHeader.hash,
      pools: [...state.pools.map(pool => this.copyPool(pool)), ...additions],
    };
    if (this.released || epoch !== this.rollbackEpoch) return null;
    await this.writeRegistry(next);
    if (this.released || epoch !== this.rollbackEpoch) return null;
    return next;
  }

  // Recover a missing registry snapshot before applying newly received logs.
  async update(
    logs: Readonly<Log>[],
    blockHeaders: Readonly<{ [blockNumber: number]: Readonly<BlockHeader> }>,
  ): Promise<void> {
    if (this.released) return;
    if (!this.getStaleState() && logs.length === 0) {
      const epoch = this.rollbackEpoch;
      const blockNumber = this.dexHelper.blockManager.getLatestBlockNumber();
      const state = await this.generateState(blockNumber);
      if (this.released || epoch !== this.rollbackEpoch) return;
      const block = await this.dexHelper.web3Provider.eth.getBlock(blockNumber);
      if (!block?.hash || lower(block.hash) !== lower(state.blockHash)) return;
      if (this.released || epoch !== this.rollbackEpoch) return;
      this.setState(state, blockNumber, 'registry_recovery');
    }
    await super.update(logs, blockHeaders);
  }

  // Cancel in-flight initialization before restarting event tracking.
  restart(blockNumber: number): void {
    if (this.released) return;
    this.rollbackEpoch++;
    super.restart(blockNumber);
    if (!this.getStaleState()) this.invalidate();
  }

  // Roll back registry state and retire subscribers for pools removed by a reorg.
  rollback(blockNumber: number): void {
    if (this.released) return;
    this.rollbackEpoch++;
    this.invalidate();
    super.rollback(blockNumber);
    if (!this.getStaleState()) return;
    const retained = new Set(
      this.getStaleState()!.pools.map(pool => pool.address),
    );
    for (const [address, pool] of this.pools) {
      if (!retained.has(address)) {
        pool.invalidate();
        pool.inactivate();
        this.pools.delete(address);
      }
    }
  }

  // Stop factory tracking and inactivate all child pool subscribers.
  releaseResources(): void {
    this.released = true;
    this.rollbackEpoch++;
    this.inactivate();
    for (const pool of this.pools.values()) pool.inactivate();
  }

  // Read the config contract at the same block as the registry snapshot.
  private async getConfigAddress(blockNumber: number): Promise<string> {
    const [result] = await this.dexHelper.multiWrapper.aggregate<any>(
      [
        {
          target: this.factoryAddress,
          callData: factoryInterface.encodeFunctionData('config'),
          decodeFunction: data =>
            factoryInterface.decodeFunctionResult('config', rawResult(data)),
        },
      ],
      blockNumber,
    );
    return lower(result[0]);
  }

  // Check whether the cached registry block remains on the canonical chain.
  private async isCanonical(registry: RegistryState): Promise<boolean> {
    if (!registry.blockHash || registry.throughBlock <= 0) return false;
    const block = await this.dexHelper.web3Provider.eth.getBlock(
      registry.throughBlock,
    );
    return Boolean(block && lower(block.hash) === lower(registry.blockHash));
  }

  // Scan factory creation logs in bounded ranges and load each pair's metadata.
  private async discoverPools(
    fromBlock: number,
    toBlock: number,
  ): Promise<PoolConfig[]> {
    if (fromBlock > toBlock) return [];
    const ranges: Array<[number, number]> = [];
    for (
      let start = fromBlock;
      start <= toBlock;
      start += DISCOVERY_CHUNK_SIZE
    ) {
      ranges.push([start, Math.min(toBlock, start + DISCOVERY_CHUNK_SIZE - 1)]);
    }
    const logs = (
      await async.mapLimit(
        ranges,
        DISCOVERY_CONCURRENCY,
        async ([from, to]: [number, number]) =>
          this.dexHelper.web3Provider.eth.getPastLogs({
            address: this.factoryAddress,
            topics: [factoryInterface.getEventTopic('NewCurve')],
            fromBlock: from,
            toBlock: to,
          }),
      )
    )
      .flat()
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    const discovered = await async.mapLimit(
      logs as any[],
      DISCOVERY_CONCURRENCY,
      async (log: any) => {
        const event = getTopicLogDecoder(factoryInterface).decode(log);
        return this.readPool(lower(event.args.curve), log.transactionHash);
      },
    );
    return this.mergePools(
      [],
      discovered.filter((pool): pool is PoolConfig => Boolean(pool)),
    );
  }

  // Decode a creation receipt and accept only verified two-token pools.
  private async readPool(
    address: string,
    transactionHash: string,
  ): Promise<PoolConfig | null> {
    if (this.isExcluded(address)) return null;
    const receipt = await this.dexHelper.web3Provider.eth.getTransactionReceipt(
      transactionHash,
    );
    const included = receipt.logs
      .filter(
        log =>
          lower(log.address) === address &&
          log.topics[0] === poolInterface.getEventTopic('AssetIncluded'),
      )
      .map(log => getTopicLogDecoder(poolInterface).decode(log).args);
    if (included.length !== 2) {
      this.logger.warn(
        `${this.dexKey}: ignoring non-pair Stabull pool ${address}`,
      );
      return null;
    }
    const tokens = included.map(args => lower(args.numeraire)) as [
      string,
      string,
    ];
    if (
      tokens[0] === tokens[1] ||
      included.some((args, index) => lower(args.reserve) !== tokens[index])
    ) {
      this.logger.warn(
        `${this.dexKey}: ignoring pool with distinct reserve and numeraire tokens ${address}`,
      );
      return null;
    }
    const weights = included.map(
      args => (asBigInt(args.weight) * ONE_64) / WEIGHT_SCALE + WEIGHT_ROUNDING,
    ) as [bigint, bigint];
    return { address, tokens, weights };
  }

  // Merge discoveries by address while keeping excluded pools out of the registry.
  private mergePools(
    current: PoolConfig[],
    additions: PoolConfig[],
  ): PoolConfig[] {
    const merged = new Map(
      current
        .filter(pool => !this.isExcluded(pool.address))
        .map(pool => [pool.address, pool]),
    );
    additions
      .filter(pool => !this.isExcluded(pool.address))
      .forEach(pool => merged.set(pool.address, pool));
    return [...merged.values()];
  }

  // Filter unsupported oracle pools configured for this network.
  private isExcluded(address: string): boolean {
    return this.excludedPools.has(lower(address));
  }

  // Reuse an active subscriber or serialize concurrent initialization attempts.
  private async ensurePool(
    config: DeepReadonly<PoolConfig>,
    blockNumber: number,
  ): Promise<void> {
    if (this.released) return;
    const address = lower(config.address);
    const current = this.pools.get(address);
    if (current && !current.isInactive()) return;
    const pending = this.poolInitializations.get(address);
    if (pending) {
      const epoch = this.rollbackEpoch;
      await pending;
      if (this.released || epoch !== this.rollbackEpoch) return;
      const ready = this.pools.get(address);
      if (ready && !ready.isInactive()) return;
      if (this.poolInitializations.get(address) === pending)
        this.poolInitializations.delete(address);
      return this.ensurePool(config, blockNumber);
    }
    const epoch = this.rollbackEpoch;
    const promise = this.initializePool(config, address, blockNumber, epoch);
    this.poolInitializations.set(address, promise);
    try {
      await promise;
    } finally {
      if (this.poolInitializations.get(address) === promise)
        this.poolInitializations.delete(address);
    }
  }

  // Create the pool subscriber, resolving its oracle dependencies at this block.
  private async initializePool(
    config: DeepReadonly<PoolConfig>,
    address: string,
    blockNumber: number,
    epoch: number,
  ): Promise<void> {
    const configAddress =
      this.configAddress ?? this.getStaleState()?.configAddress;
    if (!configAddress)
      throw new Error(`${this.dexKey}: config address is unavailable`);
    const pool = new StabullEventPool(
      this.dexKey,
      {
        ...config,
        address,
        tokens: [...config.tokens] as [string, string],
        weights: [...config.weights] as [bigint, bigint],
      },
      this.dexHelper,
      this.logger,
      configAddress,
      `${this.mapKey}_pool_states`,
    );
    try {
      await pool.initialize(blockNumber);
    } catch (error) {
      // A failed pool must not block supported pools; keep its registry entry for retry.
      pool.inactivate();
      this.logger.warn(
        `${this.dexKey}: failed to initialize pool ${address} at block ${blockNumber}`,
        error,
      );
      return;
    }
    if (this.released || epoch !== this.rollbackEpoch) {
      pool.inactivate();
      return;
    }
    const previous = this.pools.get(address);
    if (previous && !previous.isInactive()) {
      pool.inactivate();
      return;
    }
    previous?.inactivate();
    this.pools.set(address, pool);
  }

  // Persist registry progress so startup can resume from a canonical checkpoint.
  private async writeRegistry(registry: RegistryState): Promise<void> {
    if (this.released) return;
    await this.dexHelper.cache.setexAndCacheLocally(
      this.dexKey,
      Number(this.network),
      this.registryCacheKey,
      REGISTRY_TTL_SECONDS,
      Utils.Serialize(registry),
    );
  }

  // Copy readonly cached pool data into the mutable registry representation.
  private copyPool(pool: DeepReadonly<PoolConfig>): PoolConfig {
    return {
      ...pool,
      tokens: [...pool.tokens] as [string, string],
      weights: [...pool.weights] as [bigint, bigint],
    };
  }
}
