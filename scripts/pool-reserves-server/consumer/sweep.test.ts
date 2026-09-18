import { sweepStorage, wrapDescriptor } from './sweep';
import { FakeRedis } from './fake-redis';
import { Batch, SweepCounters } from './types';

const KEY = 'dl_1_test_pools';

const collect = async (
  redis: FakeRedis,
  fieldInValue: boolean,
  batchSize: number,
) => {
  const counters: SweepCounters = { scannedFields: 0, unparsable: 0, pages: 0 };
  const batches: Batch[] = [];
  for await (const b of sweepStorage(
    redis,
    KEY,
    fieldInValue,
    batchSize,
    counters,
  )) {
    batches.push(b);
  }
  return { counters, batches };
};

describe('wrapDescriptor', () => {
  it('prepends the field to a JSON object without parsing it', () => {
    expect(wrapDescriptor('7', '{"a":"0x1","t0":"0x2"}')).toEqual(
      '{"i":"7","a":"0x1","t0":"0x2"}',
    );
    expect(JSON.parse(wrapDescriptor('7', ' {"a":1} ')!)).toEqual({
      i: '7',
      a: 1,
    });
  });

  it('handles the empty object', () => {
    expect(JSON.parse(wrapDescriptor('x', '{}')!)).toEqual({ i: 'x' });
    expect(JSON.parse(wrapDescriptor('x', '{ }')!)).toEqual({ i: 'x' });
  });

  it('rejects values that are not objects', () => {
    expect(wrapDescriptor('x', '[1,2]')).toBeNull();
    expect(wrapDescriptor('x', '"str"')).toBeNull();
    expect(wrapDescriptor('x', '')).toBeNull();
    expect(wrapDescriptor('x', '{"a":1')).toBeNull();
  });
});

describe('sweepStorage', () => {
  it('re-chunks pages larger than the batch size', async () => {
    const redis = new FakeRedis();
    const flat: string[] = [];
    for (let i = 0; i < 2500; i++) flat.push(`f${i}`, `v${i}`);
    redis.scriptedPages.set(KEY, [['1', flat]]);

    const { counters, batches } = await collect(redis, true, 1000);
    expect(batches.map(b => b.fields.length)).toEqual([1000, 1000, 500]);
    expect(counters).toEqual({ scannedFields: 2500, unparsable: 0, pages: 1 });
    expect(batches[0].descriptors[0]).toEqual('v0');
    expect(batches[2].fields[499]).toEqual('f2499');
  });

  it('merges small and empty pages into full batches', async () => {
    const redis = new FakeRedis();
    redis.scriptedPages.set(KEY, [
      ['1', ['a', '1', 'b', '2']],
      ['2', []],
      ['3', ['c', '3']],
      ['0', ['d', '4', 'e', '5']],
    ]);

    const { counters, batches } = await collect(redis, true, 3);
    expect(batches.map(b => b.fields)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    expect(counters.pages).toEqual(4);
    expect(counters.scannedFields).toEqual(5);
  });

  it('wraps values for fieldInValue: false and counts unparsable ones', async () => {
    const redis = new FakeRedis();
    await redis.hset(KEY, [
      '0',
      '{"a":"0xp"}',
      '1',
      'garbage',
      '2',
      '{"a":"0xq"}',
    ]);

    const { counters, batches } = await collect(redis, false, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0].fields).toEqual(['0', '2']);
    expect(batches[0].descriptors.map(d => JSON.parse(d))).toEqual([
      { i: '0', a: '0xp' },
      { i: '2', a: '0xq' },
    ]);
    expect(counters).toEqual({ scannedFields: 3, unparsable: 1, pages: 1 });
  });

  it('passes duplicate fields through untouched', async () => {
    const redis = new FakeRedis();
    redis.scriptedPages.set(KEY, [
      ['1', ['a', '1', 'a', '1']],
      ['0', ['a', '1']],
    ]);
    const { batches } = await collect(redis, true, 10);
    expect(batches[0].fields).toEqual(['a', 'a', 'a']);
  });

  it('yields nothing for an empty storage', async () => {
    const { batches, counters } = await collect(new FakeRedis(), true, 10);
    expect(batches).toEqual([]);
    expect(counters.pages).toEqual(1);
  });
});
