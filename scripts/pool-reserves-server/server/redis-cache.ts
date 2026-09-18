import Redis from 'ioredis';
import { ICache } from '../../../src/dex-helper/icache';
import { ConsumerRedis } from '../consumer';

export type ComposeKey = (
  dexKey: string,
  network: number,
  cacheKey: string,
) => string;

// The production backend composes `<network>_<dexKey>_<cacheKey>` verbatim
// (no lowercasing); confirmed against the 2026-09-10 dump, e.g.
// `1_ParaSwapPool14_blacklisted_0x…`.
export const productionComposeKey: ComposeKey = (dexKey, network, cacheKey) =>
  `${network}_${dexKey}_${cacheKey}`;

// ICache over ioredis. Hash/set/zset/raw methods map 1:1; the
// `*AndCacheLocally` variants do not cache because a verification tool
// wants fresh reads.
export class RedisCache implements ICache {
  private subscriber?: Redis;
  private readonly channelRefs = new Map<string, number>();

  constructor(
    private readonly redis: Redis,
    private readonly composeKey: ComposeKey = productionComposeKey,
    private readonly onError: (context: string, e: unknown) => void = (
      context,
      e,
      // eslint-disable-next-line no-console
    ) => console.error(`RedisCache: ${context} failed`, e),
  ) {}

  get(dexKey: string, network: number, cacheKey: string) {
    return this.redis.get(this.composeKey(dexKey, network, cacheKey));
  }

  async mget(keys: string[]) {
    return keys.length ? this.redis.mget(...keys) : [];
  }

  ttl(dexKey: string, network: number, cacheKey: string) {
    return this.redis.ttl(this.composeKey(dexKey, network, cacheKey));
  }

  keys(dexKey: string, network: number, cacheKey: string) {
    return this.redis.keys(this.composeKey(dexKey, network, cacheKey));
  }

  rawget(key: string) {
    return this.redis.get(key);
  }

  rawset(key: string, value: string, ttl: number) {
    return this.redis.set(key, value, 'EX', ttl);
  }

  async rawdel(key: string) {
    await this.redis.del(key);
  }

  del(dexKey: string, network: number, cacheKey: string) {
    return this.redis.del(this.composeKey(dexKey, network, cacheKey));
  }

  async setex(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
    value: string,
  ) {
    await this.redis.setex(
      this.composeKey(dexKey, network, cacheKey),
      ttlSeconds,
      value,
    );
  }

  async msetex(...args: Array<string | number>) {
    if (args.length % 3 !== 0) throw new Error('msetex: wrong arity');
    const pipeline = this.redis.pipeline();
    for (let i = 0; i < args.length; i += 3) {
      pipeline.setex(String(args[i]), Number(args[i + 2]), String(args[i + 1]));
    }
    const results = await pipeline.exec();
    const failed = results?.find(([err]) => err);
    if (failed) throw failed[0];
  }

  async set(key: string, value: string) {
    await this.redis.set(key, value);
  }

  async mset(...args: string[]) {
    if (args.length) await this.redis.mset(...args);
  }

  getAndCacheLocally(dexKey: string, network: number, cacheKey: string) {
    return this.get(dexKey, network, cacheKey);
  }

  mgetAndCacheLocally(keys: string[]) {
    return this.mget(keys);
  }

  setexAndCacheLocally(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
    value: string,
  ) {
    return this.setex(dexKey, network, cacheKey, ttlSeconds, value);
  }

  async sadd(setKey: string, key: string) {
    await this.redis.sadd(setKey, key);
  }

  zadd(key: string, bulk: (number | string)[], option?: 'NX') {
    return option
      ? this.redis.zadd(key, option, ...bulk)
      : this.redis.zadd(key, ...bulk);
  }

  zremrangebyscore(key: string, min: number, max: number) {
    return this.redis.zremrangebyscore(key, min, max);
  }

  async zrem(key: string, members: string[]) {
    return members.length ? this.redis.zrem(key, ...members) : 0;
  }

  zscore(setKey: string, key: string) {
    return this.redis.zscore(setKey, key);
  }

  async sismember(setKey: string, key: string) {
    return (await this.redis.sismember(setKey, key)) === 1;
  }

  smembers(setKey: string) {
    return this.redis.smembers(setKey);
  }

  async hset(mapKey: string, key: string, value: string) {
    await this.redis.hset(mapKey, key, value);
  }

  async hdel(mapKey: string, keys: string[]) {
    return keys.length ? this.redis.hdel(mapKey, ...keys) : 0;
  }

  hget(mapKey: string, key: string) {
    return this.redis.hget(mapKey, key);
  }

  hlen(mapKey: string) {
    return this.redis.hlen(mapKey);
  }

  async hmget(mapKey: string, keys: string[]) {
    return keys.length ? this.redis.hmget(mapKey, ...keys) : [];
  }

  async hmset(mapKey: string, mappings: Record<string, string>) {
    if (Object.keys(mappings).length) await this.redis.hset(mapKey, mappings);
  }

  hgetAll(mapKey: string) {
    return this.redis.hgetall(mapKey);
  }

  async hscan(mapKey: string, cursor: string, count: number) {
    const [next, flat] = await this.redis.hscan(mapKey, cursor, 'COUNT', count);
    const entries: Record<string, string> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) entries[flat[i]] = flat[i + 1];
    return { cursor: next, entries };
  }

  async publish(channel: string, msg: string) {
    await this.redis.publish(channel, msg);
  }

  subscribe(channel: string, cb: (channel: string, msg: string) => void) {
    if (!this.subscriber) this.subscriber = this.redis.duplicate();
    const sub = this.subscriber;
    const handler = (ch: string, msg: string) => {
      if (ch === channel) cb(ch, msg);
    };
    sub.on('message', handler);
    const count = (this.channelRefs.get(channel) ?? 0) + 1;
    this.channelRefs.set(channel, count);
    if (count === 1) {
      sub
        .subscribe(channel)
        .catch(e => this.onError(`subscribe ${channel}`, e));
    }
    return () => {
      sub.off('message', handler);
      const left = (this.channelRefs.get(channel) ?? 1) - 1;
      if (left <= 0) {
        this.channelRefs.delete(channel);
        sub
          .unsubscribe(channel)
          .catch(e => this.onError(`unsubscribe ${channel}`, e));
      } else {
        this.channelRefs.set(channel, left);
      }
    };
  }

  addBatchHGet(
    mapKey: string,
    key: string,
    cb: (result: string | null) => boolean,
  ) {
    void this.redis
      .hget(mapKey, key)
      .then(cb)
      .catch(() => cb(null));
  }

  async quit() {
    await this.subscriber?.quit();
  }
}

export function toConsumerRedis(redis: Redis): ConsumerRedis {
  return {
    hlen: key => redis.hlen(key),
    hscan: (key, cursor, count) => redis.hscan(key, cursor, 'COUNT', count),
    hset: async (key, fieldValues) => {
      if (fieldValues.length) await redis.hset(key, ...fieldValues);
    },
    expire: async (key, seconds) => {
      await redis.expire(key, seconds);
    },
    del: async keys => {
      if (keys.length) await redis.del(...keys);
    },
    transaction: async commands => {
      // ioredis dispatches MULTI entries by method name, hence lowercase
      const results = await redis
        .multi(commands.map(([cmd, ...args]) => [cmd.toLowerCase(), ...args]))
        .exec();
      if (!results) throw new Error('transaction aborted');
      const failed = results.find(([err]) => err);
      if (failed) throw failed[0];
    },
    eval: (script, keys, args) =>
      redis.eval(script, keys.length, ...keys, ...args),
  };
}
