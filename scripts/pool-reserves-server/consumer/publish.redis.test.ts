// Runs the publish/write Lua scripts against a real Redis, because FakeRedis
// interprets them by hand. Opt-in: set POOL_RESERVES_TEST_REDIS_URL.
import Redis from 'ioredis';
import { RunSink } from './publish';
import { reservesKeys } from './keys';
import { toConsumerRedis } from '../server/redis-cache';

const url = process.env.POOL_RESERVES_TEST_REDIS_URL;
const describeIf = url ? describe : describe.skip;

describeIf('RunSink against a real Redis', () => {
  const redis = new Redis(url!);
  const prefix = `test:pool-reserves:${process.pid}`;
  const keys = reservesKeys('dex', 1, prefix);
  const consumer = () => toConsumerRedis(redis);

  afterEach(async () => {
    const found = await redis.keys(`${prefix}:*`);
    if (found.length) await redis.del(...found);
  });
  afterAll(() => redis.quit());

  it('publishes a persistent hash and refreshes the staging TTL', async () => {
    const sink = new RunSink(consumer(), keys, 'run1');
    await sink.write(['a', '1']);
    expect(await redis.ttl(sink.tmpKey)).toBeGreaterThan(3500);
    await redis.expire(sink.tmpKey, 100);
    await sink.write(['b', '2']);
    expect(await redis.ttl(sink.tmpKey)).toBeGreaterThan(3500);

    await sink.publish(keys, '{"meta":1}');
    expect(await redis.ttl(keys.target)).toEqual(-1);
    expect(await redis.hgetall(keys.target)).toEqual({ a: '1', b: '2' });
    expect(await redis.get(keys.meta)).toEqual('{"meta":1}');
    expect(await redis.exists(sink.tmpKey)).toEqual(0);
  });

  it('refuses to write into a staging hash that disappeared', async () => {
    const sink = new RunSink(consumer(), keys, 'run2');
    await sink.write(['a', '1']);
    await redis.del(sink.tmpKey);
    await expect(sink.write(['b', '2'])).rejects.toThrow(/STAGING_MISSING/);
    expect(await redis.exists(sink.tmpKey)).toEqual(0);
  });

  it('refuses to publish when the staging hash is missing and leaves meta alone', async () => {
    await redis.hset(keys.target, 'old', '1');
    await redis.set(keys.meta, 'old-meta');
    const sink = new RunSink(consumer(), keys, 'run3');
    await sink.write(['a', '1']);
    await redis.del(sink.tmpKey);
    await expect(sink.publish(keys, 'new-meta')).rejects.toThrow(
      /STAGING_MISSING/,
    );
    expect(await redis.hgetall(keys.target)).toEqual({ old: '1' });
    expect(await redis.get(keys.meta)).toEqual('old-meta');
  });

  it('publishes an empty run by deleting the target', async () => {
    await redis.hset(keys.target, 'old', '1');
    await redis.set(keys.lastFailure, 'x');
    const sink = new RunSink(consumer(), keys, 'run4');
    await sink.publish(keys, 'empty-meta');
    expect(await redis.exists(keys.target)).toEqual(0);
    expect(await redis.get(keys.meta)).toEqual('empty-meta');
    expect(await redis.exists(keys.lastFailure)).toEqual(0);
  });

  it('discard removes staging and records the failure', async () => {
    const sink = new RunSink(consumer(), keys, 'run5');
    await sink.write(['a', '1']);
    await sink.discard(keys, 'failure-meta');
    expect(await redis.exists(sink.tmpKey)).toEqual(0);
    expect(await redis.get(keys.lastFailure)).toEqual('failure-meta');
  });

  it('handles a full 1000-row batch in one script call', async () => {
    const sink = new RunSink(consumer(), keys, 'run6');
    const fv: string[] = [];
    for (let i = 0; i < 1000; i++) fv.push(`f${i}`, `{"v":${i}}`);
    await sink.write(fv);
    expect(await redis.hlen(sink.tmpKey)).toEqual(1000);
  });
});
