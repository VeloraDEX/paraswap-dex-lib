import { PoolReserves, PoolsStorage } from '../../../src/types';

// The consumer talks to Redis through this minimal surface so the module can
// be hosted by any client (ioredis here, whatever the backend uses there).
export interface ConsumerRedis {
  hlen(key: string): Promise<number>;
  // Redis reply shape: next cursor plus a flat [field, value, field, value…]
  hscan(
    key: string,
    cursor: string,
    count: number,
  ): Promise<[string, string[]]>;
  // flat [field, value, field, value…]
  hset(key: string, fieldValues: string[]): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
  // MULTI/EXEC; each entry is a raw command with its arguments. Redis does
  // not roll back on a command error: every command runs, the first error
  // is rethrown afterwards.
  transaction(commands: string[][]): Promise<void>;
  // EVAL: the only way to make "rename if the staging hash still exists"
  // atomic with the metadata write
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

// In production this is an HTTP call to dex-lib; in the harness it is
// `PricingHelper.getPoolReserves` in-process.
export type GetReserves = (
  dexKey: string,
  pools?: string[],
) => Promise<PoolReserves[]>;

export type StorageMode = 'storage' | 'enumerated';

export type Batch = { fields: string[]; descriptors: string[] };

export type SweepCounters = {
  scannedFields: number;
  unparsable: number;
  pages: number;
};

export type StoredReserves = {
  address: string;
  reserves: Record<string, string>;
  updatedAt: number;
  blockNumber: number | null;
};

export type CollectStats = {
  dexKey: string;
  chainId: number;
  mode: StorageMode;
  storageKey: string | null;
  fieldInValue: boolean | null;
  runId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  blockNumber: number | null;
  concurrency: number;
  batchSize: number;
  poolsInStorage: number | null;
  scannedFields: number;
  unparsable: number;
  requested: number | null;
  returned: number;
  skipped: number | null;
  duplicateFields: number;
  duplicateRows: number;
  unexpectedId: number;
  invalid: number;
  failedBatches: number;
  batches: number;
  persistedRows: number;
  skippedSample: string[];
  unexpectedIdSample: string[];
  invalidSample: string[];
  failedBatchErrors: string[];
  zeroReserveRows: number;
  unlimitedRows: number;
  status: 'ok' | 'failed';
  failure?: string;
};

export type CollectParams = {
  dexKey: string;
  chainId: number;
  storage: PoolsStorage | null;
  getReserves: GetReserves;
  redis: ConsumerRedis;
  keyPrefix?: string;
  concurrency?: number;
  batchSize?: number;
  blockNumber?: number | null;
  now?: () => number;
  // a rejection for which the run must stop: the consumer built a request
  // dex-lib refuses (wrong mode, batch too large). Anything else is a dex
  // failure and only fails the batch.
  isRequestError?: (e: unknown) => boolean;
  // awaited; a rejection fails the run
  onBatch?: (stats: Readonly<CollectStats>) => void | Promise<void>;
};
