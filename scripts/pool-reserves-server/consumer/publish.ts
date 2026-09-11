import { ConsumerRedis } from './types';
import { ReservesKeys } from './keys';

export const TMP_TTL_SECONDS = 3600;

// KEYS: tmp, target, meta, lastFailure. ARGV: meta json, '1' when rows exist.
// RENAME carries the staging TTL over, hence PERSIST. A missing staging hash
// (expired, deleted) aborts before anything else is written; MULTI could not
// give that guarantee because it does not roll back command errors.
export const PUBLISH_SCRIPT = `
if ARGV[2] == '1' then
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return redis.error_reply('STAGING_MISSING')
  end
  redis.call('RENAME', KEYS[1], KEYS[2])
  redis.call('PERSIST', KEYS[2])
else
  redis.call('DEL', KEYS[2])
end
redis.call('SET', KEYS[3], ARGV[1])
redis.call('DEL', KEYS[4])
return 1
`;

// KEYS: tmp. ARGV: ttl seconds, '1' when the staging hash must already exist
// (every write after the first), then field/value pairs. A staging hash that
// expired or was evicted between writes must fail the run instead of being
// silently recreated with only the later batches.
export const WRITE_SCRIPT = `
if ARGV[2] == '1' and redis.call('EXISTS', KEYS[1]) == 0 then
  return redis.error_reply('STAGING_MISSING')
end
redis.call('HSET', KEYS[1], unpack(ARGV, 3))
redis.call('EXPIRE', KEYS[1], ARGV[1])
return 1
`;

// Buffers rows for one run in a temp hash so readers never see a partial
// result. Each batch is one guarded HSET plus an EXPIRE refresh in one round
// trip, so an interrupted run leaves nothing behind for longer than the TTL
// and a live run never lets its staging hash expire unnoticed.
export class RunSink {
  private touched = false;
  readonly tmpKey: string;

  constructor(
    private readonly redis: ConsumerRedis,
    keys: ReservesKeys,
    runId: string,
  ) {
    this.tmpKey = keys.tmp(runId);
  }

  async write(fieldValues: string[]): Promise<void> {
    if (fieldValues.length === 0) return;
    await this.redis.eval(
      WRITE_SCRIPT,
      [this.tmpKey],
      [String(TMP_TTL_SECONDS), this.touched ? '1' : '0', ...fieldValues],
    );
    this.touched = true;
  }

  get hasRows(): boolean {
    return this.touched;
  }

  async count(): Promise<number> {
    return this.touched ? this.redis.hlen(this.tmpKey) : 0;
  }

  // Swaps the temp hash into place together with its metadata. An empty run
  // is legitimate (empty inventory, every mode-B pool disabled): the target
  // is removed and the metadata says so, which `/reserves` distinguishes
  // from "never run".
  async publish(keys: ReservesKeys, meta: string): Promise<void> {
    await this.redis.eval(
      PUBLISH_SCRIPT,
      [this.tmpKey, keys.target, keys.meta, keys.lastFailure],
      [meta, this.touched ? '1' : '0'],
    );
  }

  // Leaves the previously published result untouched.
  async discard(keys: ReservesKeys, failureMeta: string): Promise<void> {
    await this.redis.transaction([
      ['DEL', this.tmpKey],
      ['SET', keys.lastFailure, failureMeta],
    ]);
  }
}
