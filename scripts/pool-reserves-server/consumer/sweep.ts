import { Batch, ConsumerRedis, SweepCounters } from './types';

// Wraps a stored value for `fieldInValue: false` storages without parsing
// it: `{ i: field, ...value }` per the public contract. Values that are not
// JSON objects cannot carry the field and are reported as unparsable.
export function wrapDescriptor(field: string, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') return null;
  const head = `{"i":${JSON.stringify(field)}`;
  return trimmed.length === 2 || /^\{\s*\}$/.test(trimmed)
    ? `${head}}`
    : `${head},${trimmed.slice(1)}`;
}

// Streams a storage hash as batches of at most `batchSize` descriptors.
// HSCAN COUNT is only a hint: pages can be larger, smaller or empty, so
// pages are re-chunked and never passed through as batches. Memory is
// bounded by one page plus one batch. Duplicate fields (possible while the
// hash is being rehashed) are left to the caller's reconciliation.
export async function* sweepStorage(
  redis: ConsumerRedis,
  storageKey: string,
  fieldInValue: boolean,
  batchSize: number,
  counters: SweepCounters,
): AsyncGenerator<Batch, void, void> {
  let cursor = '0';
  let fields: string[] = [];
  let descriptors: string[] = [];

  do {
    const [next, flat] = await redis.hscan(storageKey, cursor, batchSize);
    cursor = next;
    counters.pages++;

    for (let i = 0; i + 1 < flat.length; i += 2) {
      const field = flat[i];
      const value = flat[i + 1];
      counters.scannedFields++;

      const descriptor = fieldInValue ? value : wrapDescriptor(field, value);
      if (descriptor === null) {
        counters.unparsable++;
        continue;
      }
      fields.push(field);
      descriptors.push(descriptor);

      if (fields.length === batchSize) {
        yield { fields, descriptors };
        fields = [];
        descriptors = [];
      }
    }
  } while (cursor !== '0');

  if (fields.length > 0) yield { fields, descriptors };
}
