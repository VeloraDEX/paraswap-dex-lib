import { Logger } from 'log4js';
import { ICache } from '../../dex-helper/icache';
import {
  POOLS_STORAGE_FLUSH_INTERVAL_MS,
  POOLS_STORAGE_PRUNE_AGE_MS,
  POOLS_STORAGE_PRUNE_INTERVAL_MS,
} from '../../constants';

export type PoolsWriterOptions<D> = {
  cache: ICache;
  key: string;
  logger: Logger;
  // every pool the owning dex currently holds in memory, re-touched on each
  // flush so long-lived pools never age out of the storage
  listPools?: () => Iterable<[string, D]>;
  flushIntervalMs?: number;
  pruneIntervalMs?: number;
  pruneAgeMs?: number;
  hscanCount?: number;
  now?: () => number;
};

// Buffered writer for a lazily populated pools hash. Descriptors are stored
// with a last-seen timestamp `u` and pruned once they stop being touched.
export class PoolsWriter<D extends object> {
  private readonly cache: ICache;
  readonly key: string;
  private readonly logger: Logger;
  private readonly listPools?: () => Iterable<[string, D]>;
  private readonly flushIntervalMs: number;
  private readonly pruneIntervalMs: number;
  private readonly pruneAgeMs: number;
  private readonly hscanCount: number;
  private readonly now: () => number;

  private pending: Record<string, string> = {};
  private timer?: NodeJS.Timeout;
  private lastPruneAt = 0;
  private flushing = false;

  constructor(options: PoolsWriterOptions<D>) {
    this.cache = options.cache;
    this.key = options.key;
    this.logger = options.logger;
    this.listPools = options.listPools;
    this.flushIntervalMs =
      options.flushIntervalMs ?? POOLS_STORAGE_FLUSH_INTERVAL_MS;
    this.pruneIntervalMs =
      options.pruneIntervalMs ?? POOLS_STORAGE_PRUNE_INTERVAL_MS;
    this.pruneAgeMs = options.pruneAgeMs ?? POOLS_STORAGE_PRUNE_AGE_MS;
    this.hscanCount = options.hscanCount ?? 1000;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.lastPruneAt = this.now();
    this.timer = setInterval(() => {
      this.flush().catch(e =>
        this.logger.error(`PoolsWriter(${this.key}): flush failed`, e),
      );
    }, this.flushIntervalMs);
  }

  touch(field: string, descriptor: D): void {
    this.pending[field] = JSON.stringify({ ...descriptor, u: this.now() });
  }

  get pendingCount(): number {
    return Object.keys(this.pending).length;
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      if (this.listPools) {
        for (const [field, descriptor] of this.listPools()) {
          this.touch(field, descriptor);
        }
      }

      const batch = this.pending;
      this.pending = {};
      if (Object.keys(batch).length > 0) {
        try {
          await this.cache.hmset(this.key, batch);
        } catch (e) {
          this.pending = { ...batch, ...this.pending };
          throw e;
        }
      }

      if (this.now() - this.lastPruneAt >= this.pruneIntervalMs) {
        this.lastPruneAt = this.now();
        await this.prune();
      }
    } finally {
      this.flushing = false;
    }
  }

  // Removes entries whose `u` is older than `pruneAgeMs`. Entries without a
  // parsable `u` are kept: they were written by something else. Deletion
  // happens after the scan completes so the hash is not mutated mid-iteration.
  async prune(): Promise<number> {
    const threshold = this.now() - this.pruneAgeMs;
    const stale: string[] = [];
    let cursor = '0';
    do {
      const { cursor: next, entries } = await this.cache.hscan(
        this.key,
        cursor,
        this.hscanCount,
      );
      cursor = next;

      for (const [field, raw] of Object.entries(entries)) {
        let u: unknown;
        try {
          u = JSON.parse(raw)?.u;
        } catch (e) {
          continue;
        }
        if (typeof u === 'number' && u < threshold) stale.push(field);
      }
    } while (cursor !== '0');

    let removed = 0;
    for (let i = 0; i < stale.length; i += this.hscanCount) {
      removed += await this.cache.hdel(
        this.key,
        stale.slice(i, i + this.hscanCount),
      );
    }

    return removed;
  }

  release(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
