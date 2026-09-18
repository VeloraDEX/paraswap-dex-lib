import { PoolReserves } from '../../../src/types';
import { MAX_POOL_RESERVES_BATCH } from '../../../src/constants';
import {
  Batch,
  CollectParams,
  CollectStats,
  StoredReserves,
  SweepCounters,
} from './types';
import { newRunId, reservesKeys } from './keys';
import { sweepStorage } from './sweep';
import { RunSink } from './publish';
import { hasUnlimited, isZeroReserves, validateRow } from './validate';

const SAMPLE_LIMIT = 50;
const DEFAULT_CONCURRENCY = 3;

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const pushSample = (sample: string[], value: string) => {
  if (sample.length < SAMPLE_LIMIT) sample.push(value);
};

const isPositiveInteger = (n: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(n) && n >= 1 && n <= max;

// One run of the consumer for one dex: sweep → getReserves → validate →
// persist → publish. Memory is bounded by `concurrency` batches; nothing
// proportional to the storage size is retained.
export async function collectReserves(
  params: CollectParams,
): Promise<CollectStats> {
  const {
    dexKey,
    chainId,
    storage,
    getReserves,
    redis,
    concurrency = DEFAULT_CONCURRENCY,
    batchSize = MAX_POOL_RESERVES_BATCH,
    blockNumber = null,
    now = Date.now,
    isRequestError = () => false,
    onBatch,
  } = params;

  if (!isPositiveInteger(batchSize, MAX_POOL_RESERVES_BATCH)) {
    throw new Error(
      `batchSize must be an integer within 1..${MAX_POOL_RESERVES_BATCH}`,
    );
  }
  if (!isPositiveInteger(concurrency)) {
    throw new Error('concurrency must be a positive integer');
  }

  const keys = reservesKeys(dexKey, chainId, params.keyPrefix);
  const startedAt = now();
  const runId = newRunId(startedAt);
  const sink = new RunSink(redis, keys, runId);

  const stats: CollectStats = {
    dexKey,
    chainId,
    mode: storage ? 'storage' : 'enumerated',
    storageKey: storage?.key ?? null,
    fieldInValue: storage?.fieldInValue ?? null,
    runId,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    blockNumber,
    concurrency,
    batchSize,
    poolsInStorage: null,
    scannedFields: 0,
    unparsable: 0,
    requested: storage ? 0 : null,
    returned: 0,
    skipped: storage ? 0 : null,
    duplicateFields: 0,
    duplicateRows: 0,
    unexpectedId: 0,
    invalid: 0,
    failedBatches: 0,
    batches: 0,
    persistedRows: 0,
    skippedSample: [],
    unexpectedIdSample: [],
    invalidSample: [],
    failedBatchErrors: [],
    zeroReserveRows: 0,
    unlimitedRows: 0,
    status: 'ok',
  };

  // first fatal condition wins; workers stop pulling once it is set
  let fatal: string | undefined;
  const fail = (message: string) => {
    if (fatal === undefined) fatal = message;
  };

  const persist = async (rows: PoolReserves[]) => {
    const updatedAt = now();
    const fieldValues: string[] = [];
    for (const row of rows) {
      const stored: StoredReserves = {
        address: row.address,
        reserves: row.reserves,
        updatedAt,
        blockNumber,
      };
      fieldValues.push(row.id, JSON.stringify(stored));
    }
    await sink.write(fieldValues);
  };

  // Reconciles one response against the fields it was asked for (mode A) or
  // against itself (mode B). Every requested field ends up counted exactly
  // once: returned, invalid, skipped or duplicateFields.
  const reconcile = (fields: string[] | null, rows: unknown[]) => {
    const wanted = fields ? new Set(fields) : null;
    const received = new Set<string>();
    const accepted: PoolReserves[] = [];

    for (const candidate of rows) {
      const id = (candidate as Partial<PoolReserves> | null)?.id;
      if (wanted && (typeof id !== 'string' || !wanted.has(id))) {
        stats.unexpectedId++;
        pushSample(stats.unexpectedIdSample, String(id));
        continue;
      }
      if (typeof id === 'string' && received.has(id)) {
        stats.duplicateRows++;
        continue;
      }

      const problem = validateRow(candidate, dexKey);
      if (problem) {
        stats.invalid++;
        pushSample(stats.invalidSample, `${String(id)}: ${problem}`);
        if (typeof id === 'string') received.add(id);
        continue;
      }
      const row = candidate as PoolReserves;
      received.add(row.id);
      stats.returned++;
      if (isZeroReserves(row.reserves)) stats.zeroReserveRows++;
      if (hasUnlimited(row.reserves)) stats.unlimitedRows++;
      accepted.push(row);
    }

    if (fields) {
      const counted = new Set<string>();
      for (const field of fields) {
        if (counted.has(field)) {
          stats.duplicateFields++;
          continue;
        }
        counted.add(field);
        if (!received.has(field)) {
          stats.skipped!++;
          pushSample(stats.skippedSample, field);
        }
      }
    }
    return accepted;
  };

  // Never rejects: every failure is either a failed batch (the run goes on)
  // or a fatal condition.
  const processBatch = async (batch: Batch | null) => {
    try {
      stats.batches++;
      if (batch) stats.requested! += batch.fields.length;
      let response: unknown;
      try {
        response = batch
          ? await getReserves(dexKey, batch.descriptors)
          : await getReserves(dexKey);
      } catch (e) {
        if (isRequestError(e))
          return fail(`request rejected: ${errorMessage(e)}`);
        stats.failedBatches++;
        pushSample(stats.failedBatchErrors, errorMessage(e));
        if (batch) {
          stats.skipped! += batch.fields.length;
          for (const field of batch.fields)
            pushSample(stats.skippedSample, field);
        }
        return;
      }
      if (!Array.isArray(response)) {
        // a malformed response is a failed batch, so the accounting identity
        // requested = returned + invalid + skipped + duplicateFields holds
        stats.failedBatches++;
        pushSample(stats.failedBatchErrors, 'response is not an array');
        if (batch) {
          stats.skipped! += batch.fields.length;
          for (const field of batch.fields)
            pushSample(stats.skippedSample, field);
        }
        return;
      }
      const accepted = reconcile(batch ? batch.fields : null, response);
      try {
        await persist(accepted);
      } catch (e) {
        return fail(`persist failed: ${errorMessage(e)}`);
      }
      await onBatch?.(stats);
    } catch (e) {
      fail(`batch failed: ${errorMessage(e)}`);
    }
  };

  if (!storage) {
    await processBatch(null);
  } else {
    try {
      stats.poolsInStorage = await redis.hlen(storage.key);
    } catch (e) {
      fail(`hlen failed: ${errorMessage(e)}`);
    }
    const counters: SweepCounters = {
      scannedFields: 0,
      unparsable: 0,
      pages: 0,
    };
    const iterator = sweepStorage(
      redis,
      storage.key,
      storage.fieldInValue,
      batchSize,
      counters,
    )[Symbol.asyncIterator]();

    // Fixed worker pool over one shared iterator: async generators serialize
    // concurrent next() calls, so the scan advances only when a worker is
    // free and Redis reads are paced by RPC throughput. Every worker settles
    // before the run is finalized, so no batch can land after the report.
    const worker = async () => {
      while (fatal === undefined) {
        let step: IteratorResult<Batch>;
        try {
          step = await iterator.next();
        } catch (e) {
          return fail(`scan failed: ${errorMessage(e)}`);
        }
        if (step.done) return;
        await processBatch(step.value);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    stats.scannedFields = counters.scannedFields;
    stats.unparsable = counters.unparsable;
  }

  const finish = () => {
    stats.finishedAt = now();
    stats.durationMs = stats.finishedAt - stats.startedAt;
  };

  if (fatal === undefined) {
    try {
      stats.persistedRows = await sink.count();
      finish();
      await sink.publish(keys, JSON.stringify(stats));
      return stats;
    } catch (e) {
      // a lost EXEC acknowledgement is indistinguishable from a failed one:
      // the publication may have happened, the discard below is then a no-op
      fail(
        `publish failed (result may or may not be published): ${errorMessage(
          e,
        )}`,
      );
    }
  }

  finish();
  stats.status = 'failed';
  stats.failure = fatal;
  try {
    await sink.discard(keys, JSON.stringify(stats));
  } catch (e) {
    stats.failure += `; discard failed: ${errorMessage(e)}`;
  }
  return stats;
}
