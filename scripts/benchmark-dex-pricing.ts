import * as dotenv from 'dotenv';
dotenv.config();

import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import IORedis from 'ioredis';
import NodeCache from 'node-cache';
import { Network, SwapSide } from '../src/constants';
import { DummyDexHelper } from '../src/dex-helper';
import { ICache } from '../src/dex-helper/icache';
import { IDex } from '../src/dex/idex';
import { Token } from '../src/types';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const MSETEX_LUA_SCRIPT = `
  for i = 1, #KEYS do
    local v = ARGV[(i - 1) * 2 + 1]
    local ttl = tonumber(ARGV[(i - 1) * 2 + 2])
    redis.call('SET', KEYS[i], v, 'EX', ttl)
  end
  return true
`;

class RedisCache implements ICache {
  private redis: IORedis;
  private localCache: NodeCache;

  constructor(redisUrl: string) {
    this.redis = new IORedis(redisUrl, {
      enableAutoPipelining: true,
      lazyConnect: false,
      stringNumbers: true,
    });
    this.localCache = new NodeCache();
  }

  private _key(dexKey: string, network: number, cacheKey: string) {
    return `${dexKey}_${network}_${cacheKey}`;
  }

  async get(dexKey: string, network: number, cacheKey: string) {
    return this.redis.get(this._key(dexKey, network, cacheKey));
  }
  async mget(keys: string[]) {
    return this.redis.mget(keys);
  }
  async ttl(dexKey: string, network: number, cacheKey: string) {
    return this.redis.ttl(this._key(dexKey, network, cacheKey));
  }
  async keys(dexKey: string, network: number, cacheKey: string) {
    return this.redis.keys(this._key(dexKey, network, cacheKey));
  }
  async rawget(key: string) {
    return this.redis.get(key);
  }
  async rawset(key: string, value: string, ttl: number) {
    return this.redis.setex(key, ttl, value);
  }
  async rawdel(key: string) {
    await this.redis.del(key);
  }
  async del(dexKey: string, network: number, cacheKey: string) {
    return this.redis.del(this._key(dexKey, network, cacheKey));
  }
  async set(key: string, value: string) {
    await this.redis.set(key, value);
  }
  async mset(...args: string[]) {
    await this.redis.mset(...args);
  }
  async setex(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
    value: string,
  ) {
    await this.redis.setex(
      this._key(dexKey, network, cacheKey),
      ttlSeconds,
      value,
    );
  }
  async msetex(...data: Array<string | number>) {
    if (data.length % 3 !== 0) throw new Error('Incorrect number of args');
    const keys = data.filter((_, i) => i % 3 === 0);
    const args = data.filter((_, i) => i % 3 !== 0);
    await this.redis.eval(MSETEX_LUA_SCRIPT, data.length / 3, ...keys, ...args);
  }
  async getAndCacheLocally(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
  ) {
    const key = this._key(dexKey, network, cacheKey);
    const local = this.localCache.get<string>(key);
    if (local) return local;
    const remote = await this.get(dexKey, network, cacheKey);
    if (!remote) return null;
    this.localCache.set(key, remote, ttlSeconds);
    return remote;
  }
  async setexAndCacheLocally(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
    value: string,
  ) {
    await this.setex(dexKey, network, cacheKey, ttlSeconds, value);
    this.localCache.set(
      this._key(dexKey, network, cacheKey),
      value,
      ttlSeconds,
    );
  }
  async sadd(setKey: string, key: string) {
    await this.redis.sadd(setKey, key);
  }
  async zadd(key: string, bulkItemsToAdd: (number | string)[], option?: 'NX') {
    return option
      ? this.redis.zadd(key, option, ...bulkItemsToAdd)
      : this.redis.zadd(key, ...bulkItemsToAdd);
  }
  async zremrangebyscore(key: string, min: number, max: number) {
    return this.redis.zremrangebyscore(key, min, max);
  }
  async zrem(key: string, membersKeys: string[]) {
    return this.redis.zrem(key, membersKeys);
  }
  async zscore(setKey: string, key: string) {
    return this.redis.zscore(setKey, key);
  }
  async sismember(setKey: string, key: string) {
    return (await this.redis.sismember(setKey, key)) === 1;
  }
  async smembers(setKey: string) {
    return this.redis.smembers(setKey);
  }
  async hset(mapKey: string, key: string, value: string) {
    await this.redis.hset(mapKey, { [key]: value });
  }
  async hmset(mapKey: string, mappings: Record<string, string>) {
    await this.redis.hset(mapKey, mappings);
  }
  async hdel(mapKey: string, keys: string[]) {
    if (keys.length === 0) return 0;
    return this.redis.hdel(mapKey, ...keys);
  }
  async hget(mapKey: string, key: string) {
    return this.redis.hget(mapKey, key);
  }
  async hlen(mapKey: string) {
    return Number(await this.redis.hlen(mapKey));
  }
  async hmget(mapKey: string, keys: string[]) {
    return this.redis.hmget(mapKey, ...keys);
  }
  async hgetAll(mapKey: string) {
    return this.redis.hgetall(mapKey);
  }
  async publish(channel: string, msg: string) {
    await this.redis.publish(channel, msg);
  }
  subscribe(channel: string, cb: (channel: string, msg: string) => void) {
    const sub = new IORedis(REDIS_URL, {
      enableAutoPipelining: false,
      lazyConnect: false,
    });
    sub.subscribe(channel);
    sub.on('message', cb);
    return () => {
      sub.unsubscribe(channel);
      sub.quit();
    };
  }
  addBatchHGet(
    mapKey: string,
    key: string,
    cb: (result: string | null) => boolean,
  ) {
    this.redis.hget(mapKey, key).then(cb);
  }

  async close() {
    await this.redis.quit();
  }
}

const network = Network.MAINNET;

const srcToken: Token = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
  symbol: 'USDC',
};

const destToken: Token = {
  address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  decimals: 18,
  symbol: 'ETH',
};

// 50 amounts log-spaced from 0.001 to 1,000,000 USDC (decimals=6), deduped
const amounts: bigint[] = [0n];
{
  const min = 0.001;
  const max = 1_000_000;
  const steps = 49;
  const seen = new Set<bigint>([0n]);
  for (let i = 0; i < steps; i++) {
    const value = min * Math.pow(max / min, i / (steps - 1));
    const raw = BigInt(Math.round(value * 1e6));
    if (!seen.has(raw)) {
      seen.add(raw);
      amounts.push(raw);
    }
  }
}

const INIT_TIMEOUT_MS = 60_000;
const OP_TIMEOUT_MS = 30_000;

interface PoolResult {
  dexKey: string;
  poolId: string;
  getPricesVolumeMs: number;
  pricesReturned: number;
  prices: string[];
}

interface DexError {
  dexKey: string;
  phase: string;
  error: string;
}

interface DexTiming {
  dexKey: string;
  initializePricingMs: number | null;
  getPoolIdentifiersMs: number | null;
  poolCount: number;
}

interface BenchmarkOutput {
  timestamp: string;
  blockNumber: number;
  srcToken: string;
  destToken: string;
  amountCount: number;
  amountsRaw: string[];
  dexTimings: DexTiming[];
  results: PoolResult[];
  errors: DexError[];
  dexesWithNoPools: string[];
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout after ${ms}ms: ${label}`)),
      ms,
    );
    promise.then(
      val => {
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function loadDexInstances(dexHelper: any) {
  const dexInstances: { key: string; dex: IDex<any, any, any> }[] = [];
  const skippedDexes: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dexIndexModule = require('../src/dex/index');
  const DexAdapterServiceClass = dexIndexModule.DexAdapterService;

  // Temporarily patch array methods to skip undefined entries
  // caused by circular imports when running via ts-node.
  // DexAdapterService iterates the Dexes array via forEach and flatMap.
  const origForEach = Array.prototype.forEach;
  const origFlatMap = Array.prototype.flatMap;
  Array.prototype.forEach = function (cb: any, thisArg?: any) {
    return origForEach.call(
      this.filter((x: any) => x != null),
      cb,
      thisArg,
    );
  };
  (Array.prototype as any).flatMap = function (cb: any, thisArg?: any) {
    return origFlatMap.call(
      this.filter((x: any) => x != null),
      cb,
      thisArg,
    );
  };

  let dexAdapterService: any;
  try {
    dexAdapterService = new DexAdapterServiceClass(dexHelper, network);
  } catch (e: any) {
    console.error(`DexAdapterService construction failed: ${e.message}`);
    Array.prototype.forEach = origForEach;
    Array.prototype.flatMap = origFlatMap;
    process.exit(1);
  }
  Array.prototype.forEach = origForEach;
  Array.prototype.flatMap = origFlatMap;

  const allKeys: string[] = dexAdapterService.getAllDexKeys();
  // const allKeys: string[] = ['UniswapV2', 'UniswapV3'];
  for (const key of allKeys) {
    try {
      const dex = dexAdapterService.getDexByKey(key);
      dexInstances.push({ key, dex });
    } catch {
      skippedDexes.push(key);
    }
  }

  return { dexInstances, skippedDexes };
}

(async function main() {
  console.log('=== DEX getPricesVolume Benchmark ===\n');

  const dexHelper = new DummyDexHelper(network);
  const redisCache = new RedisCache(REDIS_URL);
  (dexHelper as any).cache = redisCache;
  (dexHelper.config as any).isSlave = true;
  // console.log(`Redis: ${REDIS_URL}`);

  const { dexInstances, skippedDexes } = loadDexInstances(dexHelper);

  const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
  console.log(`Network: MAINNET (${network})`);
  console.log(`Block: ${blockNumber}`);
  if (skippedDexes.length > 0) {
    console.log(`Skipped DEXes (failed to load): ${skippedDexes.join(', ')}`);
  }
  console.log(`DEXes to benchmark: ${dexInstances.length}`);
  console.log(`Pair: USDC -> ETH`);
  console.log(`Amounts: ${amounts.length} (0.001 to 1,000,000 USDC)\n`);

  const results: PoolResult[] = [];
  const errors: DexError[] = [];
  const dexesWithNoPools: string[] = [];
  const dexTimings: DexTiming[] = [];

  for (let i = 0; i < dexInstances.length; i++) {
    const { key: dexKey, dex } = dexInstances[i];
    const progress = `[${i + 1}/${dexInstances.length}]`;
    let initMs: number | null = null;
    let poolIdMs: number | null = null;

    // Initialize pricing
    if (dex.initializePricing) {
      try {
        const t0 = performance.now();
        await withTimeout(
          Promise.resolve(dex.initializePricing(blockNumber)),
          INIT_TIMEOUT_MS,
          `${dexKey}.initializePricing`,
        );
        initMs = performance.now() - t0;
      } catch (e: any) {
        console.log(
          `${progress} ${dexKey} — ERROR in initializePricing: ${e.message}`,
        );
        errors.push({ dexKey, phase: 'initializePricing', error: e.message });
        dexTimings.push({
          dexKey,
          initializePricingMs: null,
          getPoolIdentifiersMs: null,
          poolCount: 0,
        });
        if (dex.releaseResources) {
          try {
            await Promise.resolve(dex.releaseResources());
          } catch {}
        }
        continue;
      }
    }

    // Get pool identifiers
    let pools: string[];
    try {
      const t0 = performance.now();
      pools = await withTimeout(
        dex.getPoolIdentifiers(srcToken, destToken, SwapSide.SELL, blockNumber),
        OP_TIMEOUT_MS,
        `${dexKey}.getPoolIdentifiers`,
      );
      poolIdMs = performance.now() - t0;
    } catch (e: any) {
      console.log(
        `${progress} ${dexKey} — ERROR in getPoolIdentifiers: ${e.message}`,
      );
      errors.push({ dexKey, phase: 'getPoolIdentifiers', error: e.message });
      dexTimings.push({
        dexKey,
        initializePricingMs: initMs,
        getPoolIdentifiersMs: null,
        poolCount: 0,
      });
      if (dex.releaseResources) {
        try {
          await Promise.resolve(dex.releaseResources());
        } catch {}
      }
      continue;
    }

    if (!pools || pools.length === 0) {
      console.log(`${progress} ${dexKey} — no pools`);
      dexesWithNoPools.push(dexKey);
      dexTimings.push({
        dexKey,
        initializePricingMs: initMs,
        getPoolIdentifiersMs: poolIdMs,
        poolCount: 0,
      });
      if (dex.releaseResources) {
        try {
          await Promise.resolve(dex.releaseResources());
        } catch {}
      }
      continue;
    }

    console.log(
      `${progress} ${dexKey} — ${pools.length} pool(s) (init: ${
        initMs !== null ? initMs.toFixed(0) + 'ms' : 'n/a'
      }, poolIds: ${poolIdMs!.toFixed(0)}ms)`,
    );
    dexTimings.push({
      dexKey,
      initializePricingMs: initMs,
      getPoolIdentifiersMs: poolIdMs,
      poolCount: pools.length,
    });

    // Benchmark each pool individually (warm-up + measured run)
    for (const poolId of pools) {
      try {
        // Warm-up run (not measured)
        await withTimeout(
          dex.getPricesVolume(
            srcToken,
            destToken,
            amounts,
            SwapSide.SELL,
            blockNumber,
            [poolId],
          ),
          OP_TIMEOUT_MS,
          `${dexKey}.getPricesVolume(${poolId}) [warmup]`,
        );

        // Measured run
        const start = performance.now();
        const priceResult = await withTimeout(
          dex.getPricesVolume(
            srcToken,
            destToken,
            amounts,
            SwapSide.SELL,
            blockNumber,
            [poolId],
          ),
          OP_TIMEOUT_MS,
          `${dexKey}.getPricesVolume(${poolId})`,
        );
        const elapsed = performance.now() - start;

        const poolPrices =
          priceResult && priceResult.length > 0 ? priceResult[0].prices : [];

        results.push({
          dexKey,
          poolId,
          getPricesVolumeMs: Math.round(elapsed * 1000) / 1000,
          pricesReturned: poolPrices.length,
          prices: poolPrices.map(p => p.toString()),
        });

        console.log(
          `  ${poolId}: ${elapsed.toFixed(3)}ms (${poolPrices.length} prices)`,
        );
      } catch (e: any) {
        console.log(`  ${poolId}: ERROR — ${e.message}`);
        errors.push({
          dexKey,
          phase: `getPricesVolume(${poolId})`,
          error: e.message,
        });
      }
    }

    // Release resources
    if (dex.releaseResources) {
      try {
        await Promise.resolve(dex.releaseResources());
      } catch {}
    }
  }

  // Write JSON output
  const output: BenchmarkOutput = {
    timestamp: new Date().toISOString(),
    blockNumber,
    srcToken: srcToken.address,
    destToken: destToken.address,
    amountCount: amounts.length,
    amountsRaw: amounts.map(a => a.toString()),
    dexTimings,
    results,
    errors,
    dexesWithNoPools,
  };

  const outPath = path.join(__dirname, 'benchmark-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);

  // Print summary table
  console.log('\n=== Summary (sorted by time, slowest first) ===\n');
  const sorted = [...results].sort(
    (a, b) => b.getPricesVolumeMs - a.getPricesVolumeMs,
  );
  console.log(
    `${'DEX'.padEnd(30)} | ${'Pool'.padEnd(50)} | ${'Time (ms)'.padStart(
      12,
    )} | Prices`,
  );
  console.log('-'.repeat(100));
  for (const r of sorted) {
    console.log(
      `${r.dexKey.padEnd(30)} | ${r.poolId
        .slice(0, 50)
        .padEnd(50)} | ${r.getPricesVolumeMs.toFixed(3).padStart(12)} | ${
        r.pricesReturned
      }`,
    );
  }

  if (errors.length > 0) {
    console.log(`\n=== Errors (${errors.length}) ===\n`);
    for (const e of errors) {
      console.log(`  ${e.dexKey} [${e.phase}]: ${e.error}`);
    }
  }

  console.log(
    `\nDEXes with no pools for this pair: ${dexesWithNoPools.length}`,
  );
  console.log(`Total pool results: ${results.length}`);
  console.log(`Total errors: ${errors.length}`);

  await redisCache.close();
  process.exit(0);
})();
