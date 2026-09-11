import Redis from 'ioredis';
import { Logger } from 'log4js';
import { LocalParaswapSDK } from '../../../src/implementations/local-paraswap-sdk';
import { PoolsStorage } from '../../../src/types';
import { PoolReservesRequestError } from '../../../src/lib/pools-storage/reserves';
import {
  CollectStats,
  StorageMode,
  collectReserves,
  reservesKeys,
} from '../consumer';
import { RedisCache, toConsumerRedis } from './redis-cache';
import { LogCapture, RpcCounters, RpcMeter } from './instrumentation';

export type DexInit = {
  // unready: initializePricing returned but the dex holds no pools/state
  status: 'ok' | 'unready' | 'failed' | 'timeout' | 'none';
  durationMs: number;
  error?: string;
  readiness?: string;
  rpc?: RpcCounters;
  warnings?: string[];
};

export type DexEntry = {
  dexKey: string;
  mode: StorageMode;
  storage: PoolsStorage | null;
  poolsInStorageBeforeInit: number | null;
  init?: DexInit;
};

// Consumer stats plus what only the harness can see.
export type HarnessReport = CollectStats & {
  poolsInStorageBeforeInit: number | null;
  rpc: RpcCounters;
  warnings: string[];
};

export type ChainRun = {
  startedAt: number;
  finishedAt: number | null;
  blockNumber: number | null;
  dexKeys: string[];
  reports: HarnessReport[];
};

export type ChainContextOptions = {
  masterCachePrefix: string;
  initTimeoutMs: number;
  concurrency: number;
  batchSize: number;
  keyPrefix?: string;
};

const HARNESS_SUFFIX = ':harness';

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

// Everything the harness holds for one chain: the slave-mode dex-lib
// instance on top of the local Redis copy, the pool-reserve dex inventory,
// initialization results and run history.
export class ChainContext {
  readonly sdk: LocalParaswapSDK;
  readonly cache: RedisCache;
  readonly dexes = new Map<string, DexEntry>();
  readonly meter = new RpcMeter();
  ready = false;
  running: string | null = null;
  lastRun: ChainRun | null = null;
  readonly reports = new Map<string, HarnessReport>();
  private readonly logger: Logger;

  constructor(
    readonly chainId: number,
    rpcUrl: string,
    readonly redis: Redis,
    private readonly logCapture: LogCapture,
    private readonly options: ChainContextOptions,
  ) {
    this.cache = new RedisCache(redis);
    // dex keys are assigned after discovery: the list comes from the adapter
    // service the SDK itself creates
    this.sdk = new LocalParaswapSDK(chainId, [], rpcUrl, undefined, {
      cache: this.cache,
      isSlave: true,
      masterCachePrefix: options.masterCachePrefix,
    });
    this.logger = this.sdk.dexHelper.getLogger(`PoolReservesSim-${chainId}`);
  }

  async init(): Promise<void> {
    const storages = this.sdk.dexAdapterService.getPoolsStorages();
    const keys: string[] = [];
    for (const [dexKey, storage] of Object.entries(storages)) {
      try {
        this.sdk.dexAdapterService.getDexByKey(dexKey);
      } catch (e) {
        this.logger.warn(
          `${dexKey} exposes pool reserves but is not a pricing dex: ${errorMessage(
            e,
          )}`,
        );
        continue;
      }
      keys.push(dexKey);
      this.dexes.set(dexKey.toLowerCase(), {
        dexKey,
        mode: storage ? 'storage' : 'enumerated',
        storage,
        poolsInStorageBeforeInit: storage
          ? await this.redis.hlen(storage.key)
          : null,
      });
    }
    this.sdk.dexKeys = keys;
    this.meter.install(this.sdk.dexHelper);

    const blockNumber = await this.sdk.dexHelper.provider.getBlockNumber();
    this.logger.info(
      `initializing ${keys.length} pool-reserve dexes at block ${blockNumber}`,
    );
    for (const dexKey of keys) await this.initDex(dexKey, blockNumber);
    await this.loadStoredReports();
    this.ready = true;
  }

  private async initDex(dexKey: string, blockNumber: number) {
    const entry = this.dexes.get(dexKey.toLowerCase())!;
    const dex = this.sdk.dexAdapterService.getDexByKey(dexKey);
    const startedAt = Date.now();
    const before = this.meter.snapshot();
    const window = this.logCapture.open();
    const finish = (init: Omit<DexInit, 'durationMs' | 'rpc' | 'warnings'>) => {
      entry.init = {
        ...init,
        durationMs: Date.now() - startedAt,
        rpc: RpcMeter.delta(before, this.meter.snapshot()),
        warnings: this.logCapture.close(window),
      };
    };

    if (!dex.initializePricing) return finish({ status: 'none' });
    try {
      await withTimeout(
        Promise.resolve(dex.initializePricing(blockNumber)),
        this.options.initTimeoutMs,
        `${dexKey}.initializePricing`,
      );
      const probe = await this.readiness(dexKey);
      finish({
        status: probe && !probe.ready ? 'unready' : 'ok',
        readiness: probe?.detail,
      });
    } catch (e) {
      const msg = errorMessage(e);
      finish({
        status: msg.endsWith('timed out') ? 'timeout' : 'failed',
        error: msg,
      });
    }
  }

  // Dexes that swallow their own initialization failures need a look at
  // what they actually loaded.
  private async readiness(
    dexKey: string,
  ): Promise<{ ready: boolean; detail: string } | undefined> {
    const dex = this.sdk.dexAdapterService.getDexByKey(dexKey) as unknown as {
      poolManager?: { poolsByString?: Map<string, unknown> };
      pools?: Record<string, unknown> | unknown[];
      pollingPool?: { getState?: () => Promise<unknown> };
    };
    const key = dexKey.toLowerCase();
    if (key.includes('ekubo')) {
      const n = dex.poolManager?.poolsByString?.size ?? 0;
      return { ready: n > 0, detail: `pools=${n}` };
    }
    if (key.includes('maverick')) {
      const pools = dex.pools;
      const n = Array.isArray(pools)
        ? pools.length
        : Object.keys(pools ?? {}).length;
      return { ready: n > 0, detail: `pools=${n}` };
    }
    if (key.includes('woofi')) {
      // the polling object exists before its state is fetched: ask for state
      if (!dex.pollingPool?.getState) {
        return { ready: false, detail: 'pollingPool=missing' };
      }
      try {
        const state = await withTimeout(
          dex.pollingPool.getState(),
          10_000,
          `${dexKey}.getState`,
        );
        return {
          ready: state !== null && state !== undefined,
          detail: `state=${state ? 'present' : 'null'}`,
        };
      } catch (e) {
        return { ready: false, detail: `state=${errorMessage(e)}` };
      }
    }
    return undefined;
  }

  resolveDexKey(param: string): DexEntry | undefined {
    return this.dexes.get(param.toLowerCase());
  }

  keys(dexKey: string) {
    return reservesKeys(dexKey, this.chainId, this.options.keyPrefix);
  }

  async generate(dexKeys?: string[]): Promise<ChainRun> {
    if (this.running !== null) {
      throw new Error(
        `run in progress on chain ${this.chainId}: ${this.running}`,
      );
    }
    const targets = dexKeys ?? [...this.dexes.values()].map(d => d.dexKey);
    const run: ChainRun = {
      startedAt: Date.now(),
      finishedAt: null,
      blockNumber: null,
      dexKeys: targets,
      reports: [],
    };
    this.running = targets[0] ?? '';
    this.lastRun = run;
    try {
      run.blockNumber = await this.sdk.dexHelper.provider.getBlockNumber();
      for (const dexKey of targets) {
        this.running = dexKey;
        run.reports.push(await this.generateOne(dexKey, run.blockNumber));
      }
    } finally {
      this.running = null;
      run.finishedAt = Date.now();
    }
    return run;
  }

  private async generateOne(
    dexKey: string,
    blockNumber: number,
  ): Promise<HarnessReport> {
    const entry = this.dexes.get(dexKey.toLowerCase())!;
    const before = this.meter.snapshot();
    const window = this.logCapture.open();
    let stats: CollectStats;
    try {
      stats = await collectReserves({
        dexKey: entry.dexKey,
        chainId: this.chainId,
        storage: entry.storage,
        getReserves: (key, pools) =>
          this.sdk.pricingHelper.getPoolReserves(key, pools),
        redis: toConsumerRedis(this.redis),
        keyPrefix: this.options.keyPrefix,
        concurrency: this.options.concurrency,
        batchSize: this.options.batchSize,
        blockNumber,
        isRequestError: e => e instanceof PoolReservesRequestError,
      });
    } catch (e) {
      // collectReserves only throws on invalid parameters; close the window
      // so the next dex does not inherit it
      this.logCapture.close(window);
      throw e;
    }
    const report: HarnessReport = {
      ...stats,
      poolsInStorageBeforeInit: entry.poolsInStorageBeforeInit,
      rpc: RpcMeter.delta(before, this.meter.snapshot()),
      warnings: this.logCapture.close(window),
    };
    this.reports.set(entry.dexKey.toLowerCase(), report);
    await this.redis.set(
      this.keys(entry.dexKey).target + HARNESS_SUFFIX,
      JSON.stringify(report),
    );
    this.logger.info(
      `${entry.dexKey}: ${report.status} returned=${report.returned} skipped=${report.skipped} ` +
        `failedBatches=${report.failedBatches} rpc=${report.rpc.jsonRpcRequests} in ${report.durationMs}ms`,
    );
    return report;
  }

  private async loadStoredReports() {
    for (const entry of this.dexes.values()) {
      const raw = await this.redis.get(
        this.keys(entry.dexKey).target + HARNESS_SUFFIX,
      );
      if (raw) this.reports.set(entry.dexKey.toLowerCase(), JSON.parse(raw));
    }
  }

  async release(timeoutMs: number): Promise<void> {
    try {
      await withTimeout(
        this.sdk.releaseResources(),
        timeoutMs,
        'releaseResources',
      );
    } catch (e) {
      this.logger.warn(`release: ${errorMessage(e)}`);
    }
    await this.cache.quit();
  }
}
