import { Logger } from 'log4js';
import { ICache } from '../../dex-helper/icache';
import { PoolsWriter } from './pools-writer';

class FakeHashCache {
  hashes: Record<string, Record<string, string>> = {};
  hmsetCalls = 0;
  failNextHmset = false;

  async hmset(key: string, mappings: Record<string, string>) {
    this.hmsetCalls++;
    if (this.failNextHmset) {
      this.failNextHmset = false;
      throw new Error('redis down');
    }
    this.hashes[key] = { ...(this.hashes[key] ?? {}), ...mappings };
  }

  async hscan(key: string, cursor: string, count: number) {
    const fields = Object.keys(this.hashes[key] ?? {});
    const start = Number(cursor);
    const end = Math.min(start + count, fields.length);
    const entries: Record<string, string> = {};
    for (const f of fields.slice(start, end)) entries[f] = this.hashes[key][f];
    return { cursor: end >= fields.length ? '0' : String(end), entries };
  }

  async hdel(key: string, fields: string[]) {
    let n = 0;
    for (const f of fields) {
      if (this.hashes[key]?.[f] !== undefined) {
        delete this.hashes[key][f];
        n++;
      }
    }
    return n;
  }
}

type Desc = { a: string; t0: string; t1: string };

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const DAY = 24 * 60 * 60 * 1000;

describe('PoolsWriter', () => {
  let cache: FakeHashCache;
  let now: number;
  const key = 'dl_1_Test_pools';
  const desc: Desc = { a: '0xpool', t0: '0xa', t1: '0xb' };

  const mkWriter = (
    opts: Partial<ConstructorParameters<typeof PoolsWriter<Desc>>[0]> = {},
  ) =>
    new PoolsWriter<Desc>({
      cache: cache as unknown as ICache,
      key,
      logger,
      now: () => now,
      hscanCount: 2,
      ...opts,
    });

  beforeEach(() => {
    cache = new FakeHashCache();
    now = 1_000_000;
  });

  it('buffers touches and writes them on flush with a timestamp', async () => {
    const w = mkWriter();
    w.touch('p1', desc);
    expect(cache.hmsetCalls).toEqual(0);
    expect(w.pendingCount).toEqual(1);

    await w.flush();
    expect(cache.hmsetCalls).toEqual(1);
    expect(w.pendingCount).toEqual(0);
    expect(JSON.parse(cache.hashes[key].p1)).toEqual({ ...desc, u: now });
  });

  it('does not write when nothing is pending', async () => {
    const w = mkWriter();
    await w.flush();
    expect(cache.hmsetCalls).toEqual(0);
  });

  it('re-touches in-memory pools on every flush', async () => {
    const w = mkWriter({ listPools: () => [['p1', desc]] });
    await w.flush();
    now += 5 * DAY;
    await w.flush();
    expect(JSON.parse(cache.hashes[key].p1).u).toEqual(now);
  });

  it('keeps the batch pending when the write fails', async () => {
    const w = mkWriter();
    w.touch('p1', desc);
    cache.failNextHmset = true;
    await expect(w.flush()).rejects.toThrow('redis down');
    expect(w.pendingCount).toEqual(1);
    await w.flush();
    expect(cache.hashes[key].p1).toBeDefined();
  });

  it('prunes entries older than pruneAgeMs and keeps foreign entries', async () => {
    const w = mkWriter({ pruneAgeMs: 30 * DAY });
    cache.hashes[key] = {
      fresh: JSON.stringify({ ...desc, u: now - DAY }),
      stale1: JSON.stringify({ ...desc, u: now - 31 * DAY }),
      stale2: JSON.stringify({ ...desc, u: now - 400 * DAY }),
      legacy: JSON.stringify({ token0: '0xa', token1: '0xb', exchange: null }),
      garbage: 'not json',
    };
    const removed = await w.prune();
    expect(removed).toEqual(2);
    expect(Object.keys(cache.hashes[key]).sort()).toEqual([
      'fresh',
      'garbage',
      'legacy',
    ]);
  });

  it('prunes from flush only once per pruneIntervalMs', async () => {
    const w = mkWriter({
      pruneAgeMs: 30 * DAY,
      pruneIntervalMs: 6 * 60 * 60 * 1000,
    });
    w.start();
    cache.hashes[key] = {
      stale: JSON.stringify({ ...desc, u: now - 31 * DAY }),
    };
    await w.flush();
    expect(cache.hashes[key].stale).toBeDefined();

    now += 7 * 60 * 60 * 1000;
    await w.flush();
    expect(cache.hashes[key].stale).toBeUndefined();
    w.release();
  });

  it('joins an in-flight flush instead of writing twice', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const original = cache.hmset.bind(cache);
    cache.hmset = async (key, mappings) => {
      await gate;
      return original(key, mappings);
    };
    const w = mkWriter();
    w.touch('p1', desc);
    const first = w.flush();
    w.touch('p2', desc);
    const second = w.flush();
    expect(second).toBe(first);
    release();
    await first;
    expect(cache.hmsetCalls).toEqual(1);
    expect(Object.keys(cache.hashes[key])).toEqual(['p1']);
    expect(w.pendingCount).toEqual(1);
  });

  it('keeps touches made during a failing write for the next flush', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    cache.hmset = async () => {
      cache.hmsetCalls++;
      await gate;
      throw new Error('redis down');
    };
    const w = mkWriter();
    w.touch('p1', desc);
    const first = w.flush();
    w.touch('p2', { ...desc, a: '0xnewer' });
    w.release();
    release();
    await expect(first).rejects.toThrow('redis down');
    expect(w.pendingCount).toEqual(2);
    expect(JSON.parse((w as any).pending.p2).a).toEqual('0xnewer');
  });

  it('still writes buffered entries when listing pools throws', async () => {
    const w = mkWriter({
      listPools: () => {
        throw new Error('inventory broken');
      },
    });
    w.touch('p1', desc);
    await w.flush();
    expect(Object.keys(cache.hashes[key])).toEqual(['p1']);
    expect(logger.error).toHaveBeenCalled();
  });

  it('publishes without pruning when the cache has no hscan', async () => {
    // shadow the prototype method: an ICache implementation without hscan
    (cache as unknown as { hscan?: unknown }).hscan = undefined;
    cache.hashes[key] = { old: JSON.stringify({ ...desc, u: now - 40 * DAY }) };
    const w = mkWriter({ pruneIntervalMs: 0 });
    w.touch('p1', desc);
    await w.flush();
    expect(Object.keys(cache.hashes[key]).sort()).toEqual(['old', 'p1']);
    expect(await w.prune()).toEqual(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no hscan'),
    );
  });

  it('flushes immediately on start and then every 10 minutes by default', async () => {
    jest.useFakeTimers();
    try {
      const pools = new Map<string, Desc>([['p1', desc]]);
      const w = mkWriter({ listPools: () => pools.entries() });
      w.start();
      await w.flush();
      expect(cache.hmsetCalls).toEqual(1);

      // a pool discovered after start is published on the next tick
      pools.set('p2', { ...desc, a: '0xpool2' });
      jest.advanceTimersByTime(10 * 60 * 1000 - 1);
      expect(cache.hmsetCalls).toEqual(1);
      jest.advanceTimersByTime(1);
      await w.flush();
      expect(cache.hmsetCalls).toEqual(2);
      expect(Object.keys(cache.hashes[key]).sort()).toEqual(['p1', 'p2']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('start is idempotent and release clears the timer', async () => {
    jest.useFakeTimers();
    try {
      const w = mkWriter({ flushIntervalMs: 1000 });
      w.start();
      w.start();
      // let the immediate start-up flush settle before the interval fires
      await w.flush();
      w.touch('p1', desc);
      jest.advanceTimersByTime(1000);
      expect(cache.hmsetCalls).toEqual(1);

      w.release();
      w.touch('p2', desc);
      jest.advanceTimersByTime(5000);
      expect(cache.hmsetCalls).toEqual(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
