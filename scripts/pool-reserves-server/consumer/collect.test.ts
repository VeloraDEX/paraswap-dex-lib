import {
  PoolReserves,
  PoolsStorage,
  PoolsStorageType,
} from '../../../src/types';
import { UNLIMITED_RESERVES } from '../../../src/constants';
import { collectReserves } from './collect';
import { FakeRedis } from './fake-redis';
import { reservesKeys } from './keys';
import { GetReserves } from './types';

const DEX = 'testdex';
const CHAIN = 1;
const KEYS = reservesKeys(DEX, CHAIN);
const STORAGE: PoolsStorage = {
  key: 'dl_1_testdex_pools',
  type: PoolsStorageType.RedisHash,
  fieldInValue: true,
};

const T0 = '0x' + '1'.repeat(40);
const T1 = '0x' + '2'.repeat(40);

const row = (id: string, extra: Partial<PoolReserves> = {}): PoolReserves => ({
  dex: DEX,
  id,
  address: '0x' + Buffer.from(id).toString('hex').padStart(40, '0').slice(-40),
  reserves: { [T0]: '10', [T1]: '20' },
  ...extra,
});

// descriptor == field == id, like the token-pools storages
const fill = async (redis: FakeRedis, n: number) => {
  const flat: string[] = [];
  for (let i = 0; i < n; i++) flat.push(`p${i}`, `p${i}`);
  await redis.hset(STORAGE.key, flat);
};

const echo: GetReserves = async (_dex, pools) => pools!.map(p => row(p));

class RequestError extends Error {}

const run = (
  redis: FakeRedis,
  getReserves: GetReserves,
  overrides: Partial<Parameters<typeof collectReserves>[0]> = {},
) =>
  collectReserves({
    dexKey: DEX,
    chainId: CHAIN,
    storage: STORAGE,
    getReserves,
    redis,
    blockNumber: 123,
    isRequestError: e => e instanceof RequestError,
    ...overrides,
  });

describe('reservesKeys', () => {
  it('puts every key of a dex/chain pair in one cluster slot', () => {
    expect(KEYS.target).toEqual('dexlib:pools_reserves_legacy:{testdex:1}');
    expect(KEYS.meta).toEqual('dexlib:pools_reserves_legacy:{testdex:1}:meta');
    expect(KEYS.tmp('r')).toEqual(
      'dexlib:pools_reserves_legacy:{testdex:1}:tmp:r',
    );
    expect(KEYS.lastFailure).toEqual(
      'dexlib:pools_reserves_legacy:{testdex:1}:lastFailure',
    );
  });
});

describe('collectReserves (storage mode)', () => {
  it('sweeps, persists and publishes with a full reconciliation', async () => {
    const redis = new FakeRedis();
    await fill(redis, 2500);

    const stats = await run(redis, echo, { batchSize: 1000 });

    expect(stats.status).toEqual('ok');
    expect(stats.poolsInStorage).toEqual(2500);
    expect(stats.scannedFields).toEqual(2500);
    expect(stats.requested).toEqual(2500);
    expect(stats.returned).toEqual(2500);
    expect(stats.skipped).toEqual(0);
    expect(stats.batches).toEqual(3);
    expect(stats.persistedRows).toEqual(2500);
    expect(redis.hashes.get(KEYS.target)!.size).toEqual(2500);
    expect(redis.hashes.has(KEYS.tmp(stats.runId))).toBeFalsy();

    const stored = JSON.parse(redis.hashes.get(KEYS.target)!.get('p7')!);
    expect(stored).toMatchObject({
      address: row('p7').address,
      reserves: { [T0]: '10', [T1]: '20' },
      blockNumber: 123,
    });
    expect(typeof stored.updatedAt).toEqual('number');
    expect(JSON.parse(redis.strings.get(KEYS.meta)!)).toMatchObject({
      dexKey: DEX,
      runId: stats.runId,
      returned: 2500,
    });
  });

  it('never holds more than `concurrency` batches in flight', async () => {
    const redis = new FakeRedis();
    await fill(redis, 50);
    let inFlight = 0;
    let peak = 0;
    const slow: GetReserves = async (_d, pools) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return pools!.map(p => row(p));
    };

    const stats = await run(redis, slow, { batchSize: 5, concurrency: 2 });
    expect(stats.batches).toEqual(10);
    expect(peak).toEqual(2);
    expect(stats.returned).toEqual(50);
  });

  it('accounts skipped, duplicate, unexpected and invalid rows per batch', async () => {
    const redis = new FakeRedis();
    redis.scriptedPages.set(STORAGE.key, [
      ['0', ['a', 'a', 'b', 'b', 'c', 'c', 'b', 'b', 'd', 'd']],
    ]);
    const getReserves: GetReserves = async () => [
      row('a'),
      row('a'), // duplicate row
      row('zzz'), // not requested
      row('c', { address: 'not-an-address' }), // invalid
      // b skipped, d skipped
    ];

    const stats = await run(redis, getReserves, { batchSize: 10 });

    expect(stats.status).toEqual('ok');
    expect(stats.scannedFields).toEqual(5);
    expect(stats.requested).toEqual(5);
    expect(stats.returned).toEqual(1);
    expect(stats.invalid).toEqual(1);
    expect(stats.skipped).toEqual(2);
    expect(stats.duplicateFields).toEqual(1);
    expect(stats.duplicateRows).toEqual(1);
    expect(stats.unexpectedId).toEqual(1);
    expect(stats.unexpectedIdSample).toEqual(['zzz']);
    expect(stats.skippedSample).toEqual(['b', 'd']);
    expect(stats.invalidSample[0]).toMatch(/^c: address/);
    // identity: every requested field counted exactly once
    expect(stats.requested).toEqual(
      stats.returned + stats.invalid + stats.skipped! + stats.duplicateFields,
    );
    expect([...redis.hashes.get(KEYS.target)!.keys()]).toEqual(['a']);
  });

  it('counts zero and unlimited rows', async () => {
    const redis = new FakeRedis();
    await fill(redis, 3);
    const getReserves: GetReserves = async () => [
      row('p0', { reserves: { [T0]: '0', [T1]: '0' } }),
      row('p1', { reserves: { [`${T0}_${T1}`]: UNLIMITED_RESERVES } }),
      row('p2'),
    ];
    const stats = await run(redis, getReserves);
    expect(stats.zeroReserveRows).toEqual(1);
    expect(stats.unlimitedRows).toEqual(1);
    expect(stats.returned).toEqual(3);
  });

  it('keeps going after a rejected batch and marks its fields skipped', async () => {
    const redis = new FakeRedis();
    await fill(redis, 30);
    let calls = 0;
    const flaky: GetReserves = async (_d, pools) => {
      if (++calls === 2) throw new Error('rpc down');
      return pools!.map(p => row(p));
    };

    const stats = await run(redis, flaky, { batchSize: 10, concurrency: 1 });
    expect(stats.status).toEqual('ok');
    expect(stats.failedBatches).toEqual(1);
    expect(stats.failedBatchErrors).toEqual(['rpc down']);
    expect(stats.returned).toEqual(20);
    expect(stats.skipped).toEqual(10);
    expect(stats.persistedRows).toEqual(20);
  });

  it('fails the run on a request error and keeps the previous result', async () => {
    const redis = new FakeRedis();
    await fill(redis, 20);
    await redis.hset(KEYS.target, ['old', '{"kept":true}']);
    redis.strings.set(KEYS.meta, '{"old":true}');
    const rejecting: GetReserves = async () => {
      throw new RequestError('batch too large');
    };

    const stats = await run(redis, rejecting, { batchSize: 10 });
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/request rejected: batch too large/);
    expect([...redis.hashes.get(KEYS.target)!.keys()]).toEqual(['old']);
    expect(redis.strings.get(KEYS.meta)).toEqual('{"old":true}');
    expect(JSON.parse(redis.strings.get(KEYS.lastFailure)!).status).toEqual(
      'failed',
    );
    expect(redis.hashes.has(KEYS.tmp(stats.runId))).toBeFalsy();
  });

  it('fails the run when persisting fails and leaves no temp key', async () => {
    const redis = new FakeRedis();
    await fill(redis, 20);
    await redis.hset(KEYS.target, ['old', '{"kept":true}']);
    redis.failNextHset = true;

    const stats = await run(redis, echo, { batchSize: 10, concurrency: 1 });
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/persist failed: hset boom/);
    expect([...redis.hashes.get(KEYS.target)!.keys()]).toEqual(['old']);
    expect([...redis.hashes.keys()].some(k => k.includes(':tmp:'))).toBeFalsy();
  });

  it('replaces a non-empty result with an empty one and removes obsolete ids', async () => {
    const redis = new FakeRedis();
    await fill(redis, 5);
    const first = await run(redis, echo);
    expect(first.returned).toEqual(5);

    const second = await run(redis, async () => []);
    expect(second.status).toEqual('ok');
    expect(second.returned).toEqual(0);
    expect(second.skipped).toEqual(5);
    expect(redis.hashes.has(KEYS.target)).toBeFalsy();
    expect(JSON.parse(redis.strings.get(KEYS.meta)!).runId).toEqual(
      second.runId,
    );
  });

  it('refreshes the staging TTL on every write and publishes without one', async () => {
    const redis = new FakeRedis();
    await fill(redis, 30);
    const ttlSeen: number[] = [];
    const stats = await run(redis, echo, {
      batchSize: 10,
      concurrency: 1,
      onBatch: () => {
        const tmp = [...redis.ttls.keys()].find(k => k.includes(':tmp:'))!;
        ttlSeen.push(redis.ttls.get(tmp)!);
        // the clock runs between batches; the next write must reset it
        redis.ttls.set(tmp, 100);
      },
    });
    expect(ttlSeen).toEqual([3600, 3600, 3600]);
    expect(redis.ttls.has(KEYS.target)).toBeFalsy();
    expect(redis.ttls.has(KEYS.tmp(stats.runId))).toBeFalsy();
  });

  it('fails when the staging hash disappears between writes', async () => {
    const redis = new FakeRedis();
    await fill(redis, 20);
    await redis.hset(KEYS.target, ['old', '{"kept":true}']);
    let writes = 0;
    const stats = await run(redis, echo, {
      batchSize: 10,
      concurrency: 1,
      onBatch: () => {
        if (++writes === 1) {
          for (const k of redis.hashes.keys())
            if (k.includes(':tmp:')) redis.expireNow(k);
        }
      },
    });
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/persist failed: STAGING_MISSING/);
    expect([...redis.hashes.get(KEYS.target)!.keys()]).toEqual(['old']);
  });

  it('fails instead of publishing when the staging hash expired', async () => {
    const redis = new FakeRedis();
    await fill(redis, 5);
    await redis.hset(KEYS.target, ['old', '{"kept":true}']);
    redis.strings.set(KEYS.meta, '{"old":true}');
    const stats = await run(redis, echo, {
      onBatch: () => {
        for (const k of redis.hashes.keys())
          if (k.includes(':tmp:')) redis.expireNow(k);
      },
    });
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/STAGING_MISSING/);
    expect([...redis.hashes.get(KEYS.target)!.keys()]).toEqual(['old']);
    expect(redis.strings.get(KEYS.meta)).toEqual('{"old":true}');
  });

  it('records a failure when the publish transaction itself fails', async () => {
    const redis = new FakeRedis();
    await fill(redis, 5);
    redis.failNextPublish = true;
    const stats = await run(redis, echo);
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/publish failed.*eval boom/);
    expect(JSON.parse(redis.strings.get(KEYS.lastFailure)!).runId).toEqual(
      stats.runId,
    );
    expect([...redis.hashes.keys()].some(k => k.includes(':tmp:'))).toBeFalsy();
  });

  it('drains an outstanding request before finalizing when the scan fails', async () => {
    const redis = new FakeRedis();
    redis.scriptedPages.set(STORAGE.key, [
      ['1', ['a', 'a']],
      ['ERR', []], // reached by the second worker while the first holds `a`
    ]);
    let released!: () => void;
    const gate = new Promise<void>(r => (released = r));
    let outstandingAtFault = -1;
    let outstanding = 0;
    let finished = 0;
    const slow: GetReserves = async (_d, pools) => {
      outstanding++;
      await gate;
      outstanding--;
      finished++;
      return pools!.map(p => row(p));
    };
    const pending = run(redis, slow, {
      batchSize: 1,
      concurrency: 2,
      onBatch: () => {
        outstandingAtFault = outstanding;
      },
    });
    // let both workers advance: one is inside getReserves, the other hit ERR
    await new Promise(r => setTimeout(r, 20));
    expect(outstanding).toEqual(1);
    released();
    const stats = await pending;
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/scan failed/);
    expect(finished).toEqual(1);
    expect(stats.batches).toEqual(1);
    expect(outstandingAtFault).toEqual(0);
    expect([...redis.hashes.keys()].some(k => k.includes(':tmp:'))).toBeFalsy();
  });

  it('turns a throwing onBatch callback into a failed run, not an unhandled rejection', async () => {
    const redis = new FakeRedis();
    await fill(redis, 3);
    const stats = await run(redis, echo, {
      batchSize: 1,
      onBatch: () => {
        throw new Error('callback boom');
      },
    });
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/batch failed: callback boom/);
  });

  it('awaits an async onBatch callback and fails the run when it rejects', async () => {
    const redis = new FakeRedis();
    await fill(redis, 3);
    const unhandled: unknown[] = [];
    const listener = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', listener);
    try {
      const stats = await run(redis, echo, {
        batchSize: 1,
        onBatch: async () => {
          await new Promise(r => setTimeout(r, 1));
          throw new Error('async callback boom');
        },
      });
      await new Promise(r => setTimeout(r, 5));
      expect(stats.status).toEqual('failed');
      expect(stats.failure).toMatch(/batch failed: async callback boom/);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('records a failure when the final staging count fails', async () => {
    const redis = new FakeRedis();
    await fill(redis, 3);
    await redis.hset(KEYS.target, ['old', '{"kept":true}']);
    let hlenCalls = 0;
    const original = redis.hlen.bind(redis);
    redis.hlen = async key => {
      // first call is the storage HLEN, second the staging count
      if (++hlenCalls === 2) throw new Error('hlen boom');
      return original(key);
    };
    const stats = await run(redis, echo);
    expect(stats.status).toEqual('failed');
    expect(stats.failure).toMatch(/publish failed.*hlen boom/);
    expect([...redis.hashes.get(KEYS.target)!.keys()]).toEqual(['old']);
    expect(redis.strings.has(KEYS.lastFailure)).toBeTruthy();
  });

  it('stops pulling batches once a fatal error is set', async () => {
    const redis = new FakeRedis();
    await fill(redis, 50);
    let calls = 0;
    const rejecting: GetReserves = async () => {
      calls++;
      throw new RequestError('bad request');
    };
    const stats = await run(redis, rejecting, { batchSize: 5, concurrency: 2 });
    expect(stats.status).toEqual('failed');
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('counts a field returned in two different batches once in the hash', async () => {
    const redis = new FakeRedis();
    redis.scriptedPages.set(STORAGE.key, [
      ['0', ['a', 'a', 'b', 'b', 'a', 'a']],
    ]);
    const stats = await run(redis, echo, { batchSize: 2, concurrency: 1 });
    expect(stats.batches).toEqual(2);
    expect(stats.returned).toEqual(3);
    expect(stats.persistedRows).toEqual(2);
    expect(stats.duplicateFields).toEqual(0);
  });

  it('counts a null row as invalid instead of throwing', async () => {
    const redis = new FakeRedis();
    await fill(redis, 2);
    const stats = await run(redis, async () => [
      null as unknown as PoolReserves,
      row('p1'),
    ]);
    expect(stats.status).toEqual('ok');
    expect(stats.invalid).toEqual(0);
    expect(stats.unexpectedId).toEqual(1);
    expect(stats.returned).toEqual(1);
  });

  it('counts a non-array response as a failed batch, keeping the accounting identity', async () => {
    const redis = new FakeRedis();
    await fill(redis, 4);
    const stats = await run(
      redis,
      async () => null as unknown as PoolReserves[],
      { batchSize: 2, concurrency: 1 },
    );
    expect(stats.status).toEqual('ok');
    expect(stats.failedBatches).toEqual(2);
    expect(stats.failedBatchErrors).toEqual([
      'response is not an array',
      'response is not an array',
    ]);
    expect(stats.invalid).toEqual(0);
    expect(stats.requested).toEqual(
      stats.returned + stats.invalid + stats.skipped! + stats.duplicateFields,
    );
  });

  it('rejects non-integer or out-of-range parameters up front', async () => {
    const r = new FakeRedis();
    await expect(run(r, echo, { batchSize: 1001 })).rejects.toThrow(
      /batchSize/,
    );
    await expect(run(r, echo, { batchSize: 1.5 })).rejects.toThrow(/batchSize/);
    await expect(run(r, echo, { batchSize: NaN })).rejects.toThrow(/batchSize/);
    await expect(run(r, echo, { concurrency: 0 })).rejects.toThrow(
      /concurrency/,
    );
    await expect(run(r, echo, { concurrency: Infinity })).rejects.toThrow(
      /concurrency/,
    );
  });
});

describe('collectReserves (enumerated mode)', () => {
  it('calls without pools and reports requested/skipped as n/a', async () => {
    const redis = new FakeRedis();
    const getReserves = jest.fn(async () => [row('x'), row('y')]);

    const stats = await run(redis, getReserves, { storage: null });
    expect(getReserves).toHaveBeenCalledWith(DEX);
    expect(stats.mode).toEqual('enumerated');
    expect(stats.requested).toBeNull();
    expect(stats.skipped).toBeNull();
    expect(stats.returned).toEqual(2);
    expect(stats.batches).toEqual(1);
    expect(redis.hashes.get(KEYS.target)!.size).toEqual(2);
  });

  it('publishes an empty result when the dex returns nothing', async () => {
    const redis = new FakeRedis();
    const stats = await run(redis, async () => [], { storage: null });
    expect(stats.status).toEqual('ok');
    expect(redis.hashes.has(KEYS.target)).toBeFalsy();
    expect(redis.strings.has(KEYS.meta)).toBeTruthy();
  });

  it('counts a null row as invalid in enumerated mode', async () => {
    const redis = new FakeRedis();
    const stats = await run(
      redis,
      async () => [null as unknown as PoolReserves, row('x')],
      {
        storage: null,
      },
    );
    expect(stats.invalid).toEqual(1);
    expect(stats.invalidSample[0]).toMatch(/row is null/);
    expect(stats.returned).toEqual(1);
  });

  it('marks a dex failure as a failed batch, not a failed run', async () => {
    const redis = new FakeRedis();
    const stats = await run(
      redis,
      async () => {
        throw new Error('boom');
      },
      { storage: null },
    );
    expect(stats.status).toEqual('ok');
    expect(stats.failedBatches).toEqual(1);
    expect(stats.returned).toEqual(0);
  });
});
