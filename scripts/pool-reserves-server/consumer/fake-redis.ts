import { ConsumerRedis } from './types';
import { PUBLISH_SCRIPT, WRITE_SCRIPT } from './publish';

// In-memory ConsumerRedis for tests. Mirrors the Redis semantics the
// consumer relies on: TTLs travel with RENAME and are cleared by PERSIST,
// MULTI keeps executing after a command error and reports the first one at
// the end, EVAL of the publish script is interpreted natively. HSCAN pages
// can be scripted per key to reproduce oversized, empty and duplicate pages.
export class FakeRedis implements ConsumerRedis {
  hashes = new Map<string, Map<string, string>>();
  strings = new Map<string, string>();
  // remaining TTL in seconds; absent = persistent
  ttls = new Map<string, number>();
  scriptedPages = new Map<string, [string, string[]][]>();
  commands: string[][] = [];
  failNextHset = false;
  failNextPublish = false;
  failNextHlen = false;

  // simulate the clock running out on a key
  expireNow(key: string) {
    if (this.ttls.has(key)) {
      this.ttls.delete(key);
      this.hashes.delete(key);
      this.strings.delete(key);
    }
  }

  async hlen(key: string): Promise<number> {
    if (this.failNextHlen) {
      this.failNextHlen = false;
      throw new Error('hlen boom');
    }
    return this.hashes.get(key)?.size ?? 0;
  }

  async hscan(
    key: string,
    cursor: string,
    count: number,
  ): Promise<[string, string[]]> {
    const scripted = this.scriptedPages.get(key);
    if (scripted) {
      const index = Number(cursor);
      // a page labelled 'ERR' makes the scan itself fail
      if (scripted[index][0] === 'ERR') throw new Error('hscan boom');
      const [, flat] = scripted[index];
      const next = index + 1 < scripted.length ? String(index + 1) : '0';
      return [next, flat];
    }
    const entries = [...(this.hashes.get(key) ?? new Map()).entries()];
    const start = Number(cursor);
    const end = Math.min(start + count, entries.length);
    const flat: string[] = [];
    for (const [f, v] of entries.slice(start, end)) flat.push(f, v);
    return [end >= entries.length ? '0' : String(end), flat];
  }

  async hset(key: string, fieldValues: string[]): Promise<void> {
    if (this.failNextHset) {
      this.failNextHset = false;
      throw new Error('hset boom');
    }
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    for (let i = 0; i + 1 < fieldValues.length; i += 2) {
      hash.set(fieldValues[i], fieldValues[i + 1]);
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (this.hashes.has(key) || this.strings.has(key))
      this.ttls.set(key, seconds);
  }

  async del(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.hashes.delete(key);
      this.strings.delete(key);
      this.ttls.delete(key);
    }
  }

  private run(cmd: string, args: string[]) {
    switch (cmd.toUpperCase()) {
      case 'RENAME': {
        const [from, to] = args;
        const hash = this.hashes.get(from);
        if (!hash) throw new Error('ERR no such key');
        this.hashes.delete(from);
        this.hashes.set(to, hash);
        const ttl = this.ttls.get(from);
        this.ttls.delete(from);
        if (ttl !== undefined) this.ttls.set(to, ttl);
        else this.ttls.delete(to);
        return 'OK';
      }
      case 'PERSIST':
        return this.ttls.delete(args[0]) ? 1 : 0;
      case 'SET':
        this.strings.set(args[0], args[1]);
        this.ttls.delete(args[0]);
        return 'OK';
      case 'DEL': {
        let n = 0;
        for (const k of args) {
          if (this.hashes.delete(k) || this.strings.delete(k)) n++;
          this.ttls.delete(k);
        }
        return n;
      }
      case 'HSET': {
        const [key, ...fv] = args;
        if (this.failNextHset) {
          this.failNextHset = false;
          throw new Error('hset boom');
        }
        let hash = this.hashes.get(key);
        if (!hash) {
          hash = new Map();
          this.hashes.set(key, hash);
        }
        for (let i = 0; i + 1 < fv.length; i += 2) hash.set(fv[i], fv[i + 1]);
        return fv.length / 2;
      }
      case 'EXPIRE':
        if (this.hashes.has(args[0]) || this.strings.has(args[0])) {
          this.ttls.set(args[0], Number(args[1]));
          return 1;
        }
        return 0;
      case 'EXISTS':
        return this.hashes.has(args[0]) || this.strings.has(args[0]) ? 1 : 0;
      default:
        throw new Error(`unsupported ${cmd}`);
    }
  }

  async transaction(commands: string[][]): Promise<void> {
    this.commands.push(...commands);
    let firstError: unknown;
    for (const [cmd, ...args] of commands) {
      try {
        this.run(cmd, args);
      } catch (e) {
        firstError = firstError ?? e;
      }
    }
    if (firstError) throw firstError;
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    if (script === WRITE_SCRIPT) {
      const [tmp] = keys;
      const [ttl, mustExist, ...fieldValues] = args;
      if (mustExist === '1' && !this.run('EXISTS', [tmp])) {
        throw new Error('STAGING_MISSING');
      }
      this.run('HSET', [tmp, ...fieldValues]);
      this.run('EXPIRE', [tmp, ttl]);
      return 1;
    }
    if (script !== PUBLISH_SCRIPT) throw new Error('unknown script');
    if (this.failNextPublish) {
      this.failNextPublish = false;
      throw new Error('eval boom');
    }
    const [tmp, target, meta, lastFailure] = keys;
    const [metaJson, hasRows] = args;
    if (hasRows === '1') {
      if (!this.run('EXISTS', [tmp])) throw new Error('STAGING_MISSING');
      this.run('RENAME', [tmp, target]);
      this.run('PERSIST', [target]);
    } else {
      this.run('DEL', [target]);
    }
    this.run('SET', [meta, metaJson]);
    this.run('DEL', [lastFailure]);
    return 1;
  }
}
