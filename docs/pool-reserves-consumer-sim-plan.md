# Pool reserves consumer simulation — plan

Revision 5, 2026-09-10 (revision 4 + code review round 2, §13; keys carry a Cluster hash tag). Companion to `docs/pool-reserves-plan.md` (the API
this tool exercises; §6 public contract, §8 descriptor conventions, §21 open
cost question for AlgebraIntegral). Revision 2 folds in the Codex plan
review (§10) and the requirement that the consumer logic is written to be
lifted into the production service as is.

## 1. Goal

Verify the full pool-reserves cycle end to end against real production data
before the backend adopts the API: discover every dex that can produce
reserves, read the mode-A storages the production cluster actually wrote,
run `getPoolReserves` over them exactly the way the backend consumer will,
persist the result, and make the numbers inspectable over HTTP.

Two deliverables with different lifetimes:

- **`consumer/`** — the sweep/collect/publish logic. Written as the reference
  implementation of the production consumer: streaming, bounded memory,
  bounded concurrency, no dependency on Express, tests or `DummyDexHelper`.
  Its only inputs are a Redis client, a `getReserves(dexKey, pools?)`
  function and a `PoolsStorage`. In production the function is an HTTP call
  to dex-lib; here it is `PricingHelper.getPoolReserves` in-process.
- **`server/`** — the local harness around it: dex-lib in slave mode on a
  copy of the production dump, HTTP endpoints for inspection, verification
  oracles, run reports. Throwaway.

"Done" means: for Mainnet and Base, `POST /generate/:chainId` completes for
every dex; every scanned field is accounted for as returned, skipped,
duplicate or rejected; the oracles in §6 agree; the RPC cost per dex is
written down in §8; and `consumer/` can be copied into the backend with only
the `getReserves` binding changed.

## 2. Decisions

| #   | Decision                                                                           | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | dex-lib runs as **slave** (`isSlave: true`)                                        | Matches the consumer's placement in production. Missing pieces are added to `DummyDexHelper` / `LocalParaswapSDK` as optional parameters (§3).                                                                                                                                                                                                                                                                                                                                               |
| D2  | Redis: **filter the dump before loading**                                          | Dump is 9 GB, machine has 16 GB RAM. Keys are filtered to chains 1 and 8453 plus master block-number keys with a streaming RDB tool (§5), then piped into a fresh `redis-server` on port 6399. Fallback if the tool cannot parse the RDB version: full load with `--save ""`, RSS watched, abort near 13 GB and report the production run as blocked.                                                                                                                                        |
| D3  | Backend composed-key format is **discovered from the dump**                        | `ICache.get/setex(dexKey, network, cacheKey)` compose a key the backend way; `DummyCache` uses `` `${network}_${dexKey}_${cacheKey}`.toLowerCase() ``. Hash keys are raw. `RedisCache` takes a `composeKey` function; the default is the `DummyCache` form and is confirmed or replaced after the §5 survey by checking a known consumer (`UniswapV2` `cache.get` of pool lists, `StatefulEventSubscriber` `hget(mapKey, name)`). `masterCachePrefix` is taken from the `<prefix>_1_bn` key. |
| D4  | Output: **hash per dex per chain, published atomically, empty runs representable** | `dexlib:pools_reserves_legacy:{<dexKey>:<chainId>}`: field = `PoolReserves.id`, value = JSON `{ address, reserves, updatedAt, blockNumber }`. `…:meta` = run report (§4.4). Protocol in §4.3. The `{…}` is a Redis Cluster hash tag: production Redis is clustered and RENAME / MULTI / EVAL across `T`, `T:meta`, `T:tmp:*`, `T:lastFailure` need one slot.                                                                                                                                 |
| D5  | `/pools` for mode B returns **ids from the last run**                              | Mode B has no storage. Response says `mode: 'enumerated'`, `source: 'last-run'`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| D6  | Chains: **Mainnet (1) and Base (8453)** first                                      | `POOL_RESERVES_CHAINS`; RPC from `HTTP_PROVIDER_<chainId>` in `.env`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D7  | Initialization is **per dex, direct, with an explicit result**                     | `PricingHelper.initializeDex` swallows errors and retries forever, so it cannot report an outcome. The server calls `dex.initializePricing?.(blockNumber)` under a timeout → `ok / failed / timeout / none`. Because Ekubo, Maverick and WooFi swallow their own failures internally, a dex-specific readiness probe is added for those (§4.2).                                                                                                                                              |
| D8  | **Live storage is consumed, no snapshot copy**                                     | Production reads live hashes while masters and slaves keep writing; so does the tool. To keep measurement honest the server records `HLEN` of each storage before dex-lib initialization and after, so descriptors published by this process (PoolsWriter starts on slaves too) are visible as the delta.                                                                                                                                                                                    |
| D9  | **Streaming pipeline, O(batch × concurrency) memory**                              | UniswapV2 Mainnet storage has hundreds of thousands to millions of fields; nothing about a run may be proportional to that. No `Set` of seen fields, no array of all descriptors, no array of all results.                                                                                                                                                                                                                                                                                   |
| D10 | **`getReserves` is injected**, not imported                                        | `consumer/` never touches `PricingHelper`; the harness binds it. The production service binds an HTTP client.                                                                                                                                                                                                                                                                                                                                                                                |
| D11 | Code in `scripts/pool-reserves-server/`, current branch, one separate commit       | Depends on the four API commits; tooling, not library code. Own `tsconfig.json` for type-checking; own jest tests for `consumer/`.                                                                                                                                                                                                                                                                                                                                                           |
| D12 | `ioredis` devDependency                                                            | Installed (`6.0.0`), lockfile diff limited to the new entry.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 3. Library changes (minimal, backward compatible)

- `src/dex-helper/dummy-dex-helper.ts`: `DummyDexHelper(network, rpcUrl?, options?)`,
  `options: { cache?: ICache; isSlave?: boolean; masterCachePrefix?: string }`.
  `cache` replaces `DummyCache` before `AugustusApprovals` is constructed;
  `isSlave` / `masterCachePrefix` feed `new ConfigHelper(...)`. Defaults
  preserve today's behaviour.
- `src/implementations/local-paraswap-sdk.ts`: fifth constructor parameter
  `dexHelperOptions?` forwarded to `DummyDexHelper`. The `dexKeys` list stays
  a public field so the harness can construct with `[]` and assign after
  discovery (the pool-reserve dex list comes from the service the SDK
  itself creates; a second SDK is not an option because
  `StatePollingManager` keeps a per-network singleton bound to the first
  helper).

`pnpm checks` and existing unit tests stay green.

## 4. Consumer module (`scripts/pool-reserves-server/consumer/`)

Portable. Depends on `ioredis` types and `PoolsStorage` / `PoolReserves`
from `src/types.ts` only.

### 4.1 Sweep (`sweep.ts`)

```ts
type Batch = { fields: string[]; descriptors: string[] };
async function* sweepStorage(
  redis,
  storage: PoolsStorage,
  batchSize = MAX_POOL_RESERVES_BATCH,
): AsyncGenerator<Batch>;
```

- `HSCAN key cursor COUNT batchSize` until cursor `'0'`. `COUNT` is a hint:
  pages may be larger, smaller, empty. The generator refills an accumulator
  and yields batches of exactly `batchSize` (last one shorter). A page is
  never passed through as a batch.
- Descriptor per field: `fieldInValue: true` → stored value verbatim.
  `fieldInValue: false` → `{"i":<json field>,` + `value.slice(1)` when the
  value starts with `{`; otherwise the field is counted `unparsable` and not
  sent. No `JSON.parse` of the value on the hot path; the dex validates.
- Duplicate fields (possible while the hash is being rehashed) are **not**
  deduplicated here (D9). They are idempotent downstream: `HSET` overwrites,
  and the per-batch reconciliation (§4.2) counts a field returned twice as
  `duplicate`, not as an extra pool.
- Yields `poolsInStorage` (`HLEN` at start) alongside for the report.

### 4.2 Collect (`collect.ts`)

```ts
collectReserves({ dexKey, storage, getReserves, sink, concurrency = 3, onBatch }): Promise<CollectStats>
```

- Mode A: a fixed pool of `concurrency` workers pulls batches from one
  shared `sweepStorage` iterator (async generators serialize concurrent
  `next()` calls), so HSCAN advances only when a worker is free and is
  throttled by RPC. No `Promise.race` over a growing set: every worker
  settles before the run is finalized, so nothing can land after the report.
  Concurrency default 3 per dex, dexes sequential per chain. Both knobs are
  parameters; the report records them so §8 numbers are reproducible.
- Mode B: single `getReserves(dexKey)`.
- Per-batch reconciliation, O(batch): `requested = fields.length`;
  returned rows whose `id` is in the batch's field set → `returned`;
  a second row for the same `id` → `duplicate`; an `id` not in the set →
  `unexpectedId` (counted, sample kept, row dropped: the consumer must not
  persist ids it did not ask for); fields with no row → `skipped`
  (count + sample ≤ 50 per dex). Mode B: `requested`/`skipped` are
  `null`; `returned`, `duplicate` still apply.
- Row validation before the sink (cheap, structural, same invariants as
  `tests/utils-pool-reserves.ts`): `dex === dexKey`, `address` lowercase
  hex, every `reserves` key is `token` or `token_token` lowercase, every
  value is a decimal string or `UNLIMITED_RESERVES`. Violations → `invalid`
  (count + sample), row dropped.
- Rows go to the sink as they arrive; the sink pipelines `HSET` per batch
  (§4.3). Nothing is retained after a batch is reconciled.
- Errors: `getReserves` rejection → the batch is counted as `failedBatches`
  with its fields as skipped, the run continues. `PoolReservesRequestError`
  (the harness surfaces it as HTTP 400 in production) is **not** swallowed:
  it means the consumer built a malformed request and the run is marked
  `failed`. Sink errors abort the run (`failed`), see §4.3.
- Timeouts are the dex-lib side's (`FETCH_POOL_RESERVES_TIMEOUT`): a timed
  out batch comes back `[]` and counts as skipped. The report cannot tell a
  timeout from a legitimate skip without dex-lib logs; the harness captures
  those (§5.2 log capture), the production service will have them in its
  own logging.
- `zeroReserveRows`, `unlimitedRows` counted in passing.

### 4.3 Publish (`publish.ts`)

Keys: target `T = dexlib:pools_reserves_legacy:{<dexKey>:<chainId>}`,
`T:meta`, `T:lastFailure`, temp `T:tmp:<runId>` (runId = ISO timestamp +
random suffix). All share the hash tag, so they live in one Cluster slot.

1. Sink writes each batch with one `EVAL` (`WRITE_SCRIPT`): for every write
   after the first, `EXISTS tmp` or abort with `STAGING_MISSING`; `HSET`;
   `EXPIRE 3600`. The TTL is refreshed on every write, an interrupted run
   cannot leave garbage behind for longer than the TTL, and a staging hash
   that expired or was evicted mid-run fails the run instead of being
   recreated with only the later batches.
2. On success, one `EVAL` (`PUBLISH_SCRIPT`):
   - non-empty: `EXISTS tmp` or abort with `STAGING_MISSING`; `RENAME tmp T`;
     `PERSIST T` (RENAME carries the staging TTL over); `SET T:meta`; `DEL
T:lastFailure`.
   - empty (`returned === 0`, legitimate for an empty inventory or an
     all-disabled mode-B dex): `DEL T`; `SET T:meta`; `DEL T:lastFailure`.
     `/reserves` then returns `total: 0` with the meta, distinct from 404
     "never run".
     A Lua script rather than MULTI because Redis does not roll back command
     errors inside MULTI: a failed RENAME would still let the meta write
     through.
3. On failure (scan error, sink error, `PoolReservesRequestError`, a
   throwing callback, a failed publish): `MULTI [DEL tmp; SET
T:lastFailure]`; `T` and `T:meta` untouched. A rejected publish is
   reported as "result may or may not be published": a lost EXEC
   acknowledgement is indistinguishable from a refused one.
4. A per-chain lock covers `POST /generate/:chainId` and
   `POST /generate/:chainId/:dexKey`; overlapping requests get 409.

### 4.4 Report (`CollectStats`, stored as `T:meta`)

```ts
{
  dexKey, chainId, mode: 'storage' | 'enumerated', storageKey, fieldInValue,
  runId, startedAt, finishedAt, durationMs, blockNumber,
  concurrency, batchSize,
  poolsInStorage: number | null,         // HLEN at sweep start
  poolsInStorageBeforeInit: number | null, // harness-only, D8
  scannedFields, unparsable, requested, returned, skipped, duplicate,
  unexpectedId, invalid, failedBatches, batches,
  skippedSample: string[], unexpectedIdSample: string[], invalidSample: string[],
  zeroReserveRows, unlimitedRows,
  rpc: { jsonRpcRequests, multicallSubCalls },  // harness-only, §5.2
  warnings: string[],                            // harness-only, captured dex-lib warn/error logs
  status: 'ok' | 'failed', failure?: string
}
```

### 4.5 Tests (`consumer/*.test.ts`, jest, fake Redis in memory)

- Sweep: page larger than `batchSize` is re-chunked; empty intermediate
  pages; last partial batch; `fieldInValue: false` wrapping; non-object
  value → `unparsable`.
- Collect: duplicate field returned twice → `duplicate: 1`, one row
  persisted; `unexpectedId` dropped; invalid row dropped; concurrency cap
  respected (assert max in-flight); rejected batch → `failedBatches: 1`,
  fields counted skipped, run `ok`; `PoolReservesRequestError` → run
  `failed`, no publish.
- Publish: non-empty → `RENAME` + meta atomically; empty → `DEL` + meta;
  failure → previous `T` and `T:meta` intact, tmp deleted; non-empty →
  empty replacement removes obsolete ids.

## 5. Harness (`scripts/pool-reserves-server/server/`)

### 5.1 Files

| File                 | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis-cache.ts`     | `RedisCache implements ICache` over `ioredis` (D3). Composed-key methods use `composeKey`; hash/set/zset/raw methods map 1:1; `hscan` returns `{ cursor, entries }`; `publish`/`subscribe` on a duplicated connection; `addBatchHGet` = immediate `hget`; the `*AndCacheLocally` variants do not cache.                                                                                                                                                                                                                                                                                                         |
| `chain-context.ts`   | Per chainId: `new LocalParaswapSDK(network, [], rpcUrl, undefined, { cache, isSlave: true, masterCachePrefix })`; `dexKeys = Object.keys(dexAdapterService.getPoolsStorages())`; asserts every key passes `getDexByKey` (no legacy pool-tracker dex implements `getPoolReserves` today; a difference is logged). Records `HLEN` per storage **before** initialization (D8). D7 initialization with timeout (default 120 s) and readiness probes: EkuboV3 `poolManager.poolsByString.size > 0`; MaverickV2 `pools.length > 0`; WooFiV2 poller state present. Installs the RPC counter and log capture from §5.2. |
| `instrumentation.ts` | Wraps `dexHelper.provider.send` and `web3Provider.currentProvider.send` to count JSON-RPC requests, and `multiWrapper.aggregate/tryAggregate` to count multicall sub-calls. A log4js appender registered on the dex-lib categories collects `warn`/`error` lines while a dex is being initialized or collected; the harness attributes them by phase (`init` / `collect`) because dexes run one at a time. Background timers from other dexes can still leak into a window; the report notes this and counts are labelled as upper bounds.                                                                      |
| `verify.ts`          | §6 oracles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `index.ts`           | Express app, env, CLI flags `--generate`, `--exit`, graceful shutdown: `releaseResources` for every context with a 30 s bound, then `redis.quit()`, then `process.exit`. `PricingHelper.releaseDexResources` retries forever on failure, so the bound is needed.                                                                                                                                                                                                                                                                                                                                                |
| `tsconfig.json`      | Extends root, `rootDir: ../..`, `noEmit`, includes `./**/*.ts` and `../../src/**/*.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `redis-local.sh`     | §5.3 steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `README.md`          | Run instructions, endpoints, report fields, and a "porting to production" section listing what `consumer/` needs from its host (Redis client, `getReserves`, logger).                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 5.2 Endpoints

| Route                                                         | Response                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                 | `{ ok, chains: [{ chainId, ready }] }`                                                                                                                                                                                                               |
| `GET /dexs/:chainId`                                          | `{ chainId, dexs: [{ dexKey, mode, storage, init: { status, readiness?, durationMs, error? }, poolsInStorageBeforeInit, poolsInStorageNow }] }`                                                                                                      |
| `GET /pools/:dexKey/:chainId?cursor=&count=`                  | mode A: one `HSCAN` page → `{ mode: 'storage', key, fieldInValue, total (HLEN), cursor, pools: [{ id, descriptor }] }`; mode B: `{ mode: 'enumerated', source: 'last-run', total, cursor, ids }` (D5). Paginated, never a full scan in one response. |
| `GET /pools/:dexKey/:chainId/:id`                             | `HGET` of one descriptor (mode A) or one stored row (mode B); 404 if absent. Used to classify `skippedSample` entries.                                                                                                                               |
| `GET /reserves/:dexKey/:chainId?cursor=&count=`               | `{ meta, total, cursor, reserves: [...] }`; 404 when `T:meta` absent; `total: 0` with meta after an empty run.                                                                                                                                       |
| `GET /reserves/:dexKey/:chainId/:id`                          | one row.                                                                                                                                                                                                                                             |
| `POST /generate/:chainId` / `POST /generate/:chainId/:dexKey` | Runs `collectReserves` (all dexes sequentially / one); returns `{ chainId, blockNumber, reports }`; 409 while a run is active on the chain.                                                                                                          |
| `GET /status/:chainId`                                        | `{ init, running: dexKey \| null, lastRun, lastFailures }`                                                                                                                                                                                           |
| `GET /verify/:dexKey/:chainId?sample=50`                      | §6.                                                                                                                                                                                                                                                  |

Unknown chain → 404; unknown dexKey → 404 with known keys;
`PoolReservesRequestError` → 400 (and the run is `failed`, §4.2).

### 5.3 Loading the production dump

1. Survey without loading: `redis-rdb-cli` (`rct -f count`, `rct -f mem -l 200`),
   version pinned in `redis-local.sh`. Output: key patterns, sizes, types,
   source DB index, RDB version. Answers D3 and confirms which mode-A
   storages exist.
2. Filter: `rct -f resp -k '<regex>'` with the regex written from step 1
   (chains 1 and 8453, master block-number keys). Record excluded key
   counts.
3. `redis-server --port 6399 --save "" --appendonly no --dir <tmpdir>`.
4. `redis-cli -p 6399 --pipe < filtered.resp`; record `DBSIZE`, import
   errors, and `HLEN` of every expected storage key into §8.
5. Expiry: RDB stores absolute expiry times; keys expired since the backup
   vanish on load. Slave-mode state misses fall back to `generateState`
   over RPC, as a real slave would. Their cost lands in the `init` phase
   counters, not the sweep.

## 6. Verification (per chain)

### 6.1 Coverage

1. `GET /dexs/:chainId` lists every §2.1 dex of the API plan configured on
   the chain as `storage` and every §2.2 dex as `enumerated`. Missing key →
   finding.
2. For every mode-A storage, `poolsInStorageBeforeInit` is recorded. Zero
   means the dump holds no production inventory for that dex; the dex is
   marked **not verified on production data** in §8 (a locally published
   inventory is still swept, so the code path runs, but it is not the
   production input). Zero is a fact to explain (filter, expiry, dex
   deployed after the backup), not a pass.
3. Mode B: for each dex the expected set of ids comes from the dex's own
   configuration on that chain (the same source `getPoolIdentifiers`
   uses); rows may legitimately be absent for frozen/paused pools
   (AaveGsm frozen, WooFi paused) and the report lists absent ids so the
   reason can be checked. Directional/plain key shapes and `unlimited`
   placement are checked against the §7 table of the API plan for every
   returned row, not spot-checked.

### 6.2 Accounting

4. For every mode-A dex: `scannedFields === returned + skipped + duplicate + unparsable`
   (identity on the report), `unexpectedId === 0`, `invalid === 0`,
   `failedBatches === 0`, `status: 'ok'`.
5. `skipped / requested` recorded per dex; investigation threshold > 20 %
   for UniswapV2 / Solidly families and any non-zero `unparsable` on
   PancakeSwapV2. Each `skippedSample` entry is classified via
   `GET /pools/:dexKey/:chainId/:id` (legacy format, invalid pool,
   token contradiction, RPC failure seen in `warnings`).

### 6.3 Values

Oracles are protocol-specific and block-aware. The tool has dex instances
in-process, so for state-derived values it reads the pool's
`getStateBlockNumber()` and compares at that block, not at latest.

6. UniswapV2 / Solidly (RPC path): re-read `getReserves()` at the block the
   run recorded; equality expected for pools that had no swap in between;
   pools that differ are re-read at latest and must match one of the two.
   `sample=50`, pass if ≥ 45 match.
7. MaverickV2 / Algebra / AlgebraIntegral (state path): `balanceOf` of both
   tokens at the pool's state block must equal the stored values exactly.
8. EkuboV3: no on-chain oracle for virtual TVL. Check: the set of returned
   ids equals the set of pool keys in `poolManager` minus invalid pools;
   values are non-negative decimals; no `unlimited`.
9. Mode B: each dex's capacity rule from the §7 table is re-derived from a
   direct contract read at the run block for one dex per family (LitePsm
   `gem` balances, AaveGsm exposure cap arithmetic, ERC4626 `totalAssets`).
10. Agreement is counted per pool: all tokens of the pool must agree. Zero
    denominators are handled with bigint comparison, never floats. Failed
    oracle calls are reported as `unverified`, not as agreement. Fewer
    eligible pools than `sample` → all of them, and the report says so.
    Missing production data or an unavailable oracle yields "not
    verified", which blocks an overall pass for that dex.

### 6.4 Behaviour

11. Second `POST /generate` on the same chain while one runs → 409; a later
    one succeeds and readers saw complete data throughout (spot-check with
    a polling reader during the run).
12. Non-empty → empty replacement removes obsolete ids; killing Redis
    mid-run leaves `T`/`T:meta` from the previous run intact and a
    `lastFailure`.
13. `SIGINT` exits within 30 s with no leaked timers.
14. `pnpm checks`, `pnpm test src/lib/pools-storage src/dex/pool-reserves`,
    `npx tsc -p scripts/pool-reserves-server/tsconfig.json`, and
    `npx jest scripts/pool-reserves-server/consumer` green.

## 7. Risks

- **Memory**: D2 filtering and D9 streaming; Redis RSS and node heap are
  recorded after a full Mainnet run.
- **RPC load**: sequential dexes, `concurrency` capped, private providers.
  Rate limiting is invisible to the consumer's own counters (dex-lib swallows
  it); the harness catches it in `warnings`. The production service must
  rely on dex-lib logs for the same signal — documented in the README.
- **State freshness**: `DummyBlockManager` processes no logs; state loaded
  from the dump stays at the dump's block and state generated at init stays
  at the init block. Production slaves have a live block manager. Values
  from the state path are therefore verified at the state block (§6.3),
  and the report carries `blockNumber` of the run plus, for state-path
  dexes, the min/max state block seen.
- **Slave initialization side effects**: PoolsWriter flushes on slaves,
  AlgebraIntegral `updatePoolsTvl` runs with `DummyDexHelper`'s fake USD
  pricing, so locally published inventories are not production-equivalent.
  D8 makes the delta visible; only pre-init inventories count as
  production input.
- **Dump staleness**: descriptors may reference pools that changed after
  the backup; reserves are read now. That is the real consumer situation.

## 8. Measurements — run 1, 2026-09-10

Dump: `pool-tracker-deprecation-backup-0001.rdb` (RDB v10, Redis 7.1,
`used-mem` 10.7 GB, 2.46 M keys). Filtered to chains 1 and 8453 + `is_*`:
19 669 keys, 4.63 GB in Redis. `concurrency=3`, `batchSize=1000`, slave
mode, `masterCachePrefix=is`. Whole-chain runs: Mainnet 48 dexes in 47 s,
Base 16 dexes in 54 s. Node RSS after both runs: 221 MB (Mainnet
instance), 128 MB (Base instance).

Mode A (production inventories; `rpc` = JSON-RPC requests during the sweep):

| chain | dexKey                                | poolsInStorageBeforeInit | scanned   | returned | skipped % | rpc | ms     | verified                        |
| ----- | ------------------------------------- | ------------------------ | --------- | -------- | --------- | --- | ------ | ------------------------------- |
| 1     | UniswapV2                             | 452 980                  | 452 980   | 50 526   | 88.8      | 453 | 14 188 | getReserves 50/50 at run block  |
| 1     | SushiSwap                             | 493 749                  | 493 749   | 2 308    | 99.5      | 489 | 9 288  | –                               |
| 1     | ShibaSwap                             | 493 688                  | 493 688   | 433      | 99.9      | 292 | 7 924  | –                               |
| 1     | DefiSwap                              | 493 741                  | 493 741   | 98       | 99.98     | 93  | 4 217  | –                               |
| 1     | Verse                                 | 493 736                  | 493 736   | 29       | 99.99     | 29  | 4 863  | –                               |
| 1     | RingV2                                | 405 645                  | 405 645   | 67       | 99.98     | 64  | 4 506  | –                               |
| 1     | PancakeSwapV2 (`fieldInValue: false`) | 7 983                    | 7 983     | 7 983    | 0         | 16  | 1 825  | getReserves 30/30               |
| 8453  | UniswapV2                             | 452 307                  | 452 307   | 29 455   | 93.5      | 453 | 13 099 | getReserves 50/50               |
| 8453  | Aerodrome                             | 921 696                  | 921 696   | 5 151    | 99.4      | 920 | 17 283 | getReserves 49/50 + 1 at latest |
| 8453  | Equalizer                             | 921 636                  | 921 636   | 294      | 99.97     | 254 | 10 171 | –                               |
| 8453  | Alien                                 | 1 473 412                | 1 473 412 | 400      | 99.97     | 348 | 13 530 | –                               |

Mode A storages absent from the dump (dexes deployed after the backup),
swept from the locally published inventory only:

| chain | dexKey      | published locally | returned | rpc | verified                                                 |
| ----- | ----------- | ----------------- | -------- | --- | -------------------------------------------------------- |
| 1     | EkuboV3     | 123               | 123      | 0   | id set = pool manager 123/123                            |
| 1     | MaverickV2  | 68                | 68       | 0   | balanceOf: 53 exact, 8 within 1e-6, 7 lag (see §11)      |
| 1     | Supernova   | 9                 | 9        | 1   | –                                                        |
| 8453  | MaverickV2  | 114               | 114      | 0   | balanceOf: 109 agree, 5 differ (see §11)                 |
| 8453  | QuickSwapV4 | 51                | 51       | 1   | balanceOf: 49 agree, 1 active pool 1.5 % off (state lag) |

Mode B: 38 dexes on Mainnet and 10 on Base, all `status: ok`, one
`getPoolReserves` call each, 0–4 RPC requests. Row counts: AaveV3 67/15,
AaveV3Stata 28/7, AaveV3StataV2 16/13, AaveV3Lido 9, AngleTransmuter 2,
Swell 2, OSwap 2, everything else 1. AaveGsm returned 0 rows: both Mainnet
GSMs (`GSM_USDC`, `GSM_USDT`) report `getIsSeized() == true` on-chain, so
omission is the specified behaviour.

Accounting identities held on every dex: `scanned = requested + unparsable`,
`requested = returned + invalid + skipped + duplicateFields`, with
`unparsable = invalid = unexpectedId = duplicateFields = duplicateRows =
failedBatches = 0` everywhere and no captured warnings except one OSwap
`generateState` revert during its run (2 rows still returned).

Cost: UniswapV2-family sweeps make one multicall per batch of 1000
descriptors, containing only the pairs that exist (50 526 sub-calls in 453
requests for UniswapV2 Mainnet), ≈ 30 ms per 1000 descriptors end to end
including HSCAN. The 1.47 M-field Alien hash sweeps in 13.5 s.

## 9. Out of scope

- The production service itself (HTTP binding of `getReserves`, scheduling,
  metrics export, auth). `consumer/` is written for it; wiring is theirs.
- Backend `ICache.hscan` implementation (`RedisCache` here is a reference).
- Pruning behaviour (covered by `pools-writer.test.ts`).
- Other chains in the first pass.

## 10. Plan review — responses

Codex Plan Reviewer, round 1 (REJECT). Accepted: HSCAN re-chunking and
duplicate handling (§4.1); per-batch reconciliation with `unexpectedId`
and `duplicate` instead of `requested − returned` (§4.2); empty/failed run
publication protocol and chain lock on both routes (§4.3); log capture and
provider-level RPC counting because dex-lib swallows RPC failures (§5.1);
pre-init `HLEN` because PoolsWriter runs on slaves (D8); state-block
oracles because `DummyBlockManager` never advances state (§6.3, §7);
readiness probes for Ekubo/Maverick/WooFi (D7); SDK construction order and
the `toLowerCase()` in D3; paginated `/pools` plus single-id lookup (§5.2);
bounded shutdown (§5.1).

Partially accepted: the coverage matrix is reduced to per-dex expected ids
from the dex's own configuration and the §7 key-shape rules applied to
every row, not independently sourced inventories; RPC attribution is by
phase (`init` / `collect`) only.

Rejected: keeping a snapshot copy of storages for the sweep — production
reads live hashes and so does the tool (D8 replaces it).

## 11. Run 1 findings

1. **Skip ratio is dominated by non-existent pairs.** 40/40 sampled
   UniswapV2 and 30/30 Aerodrome skipped descriptors are
   `{ token0, token1, checkExistenceAfter }` without `exchange`: pairs the
   factory reported as absent, cached to avoid re-asking. The dex drops
   them without RPC. So the §6.2 threshold of 20 % is meaningless for this
   family; the useful check is "every skipped descriptor lacks `exchange`",
   which held. For the production consumer this means ~90 % of the bytes
   read from UniswapV2-family hashes are placeholders; the sweep still costs
   ≈ 13–17 s per 450 k–1.5 M fields, so no change is needed now.
2. **State-path oracles need to run right after generation.** MaverickV2
   refreshes pool state on its own timer, so by the time `/verify` runs the
   in-memory state block has moved past the run block and the stored value
   reflects an older state. Remaining "disagree" rows on Mainnet are all
   < 0.1 % apart on active pools. One Base MaverickV2 pool
   (`0x6e4cf8db78ec226c3655d4243669d61e29ff192d`) reports `reserveA`
   4 601 682 against a token balance of 5.04e16 — worth a look by the
   Maverick maintainer, not a consumer issue.
3. **Slave initialization is cheap here**: 48 dexes in 5.9 s on Mainnet,
   16 in 3.4 s on Base, because UniswapV2 pools are created lazily and the
   mode-B dexes are single contracts. Expired master state was not a
   factor for the pool-reserve dexes.
4. **ts-node module resolution**: `import … from './bebop/bebop'` resolves
   to `bebop.json` under plain ts-node, leaving an `undefined` in `Dexes`.
   The npm script sets `TS_NODE_PREFER_TS_EXTS=true`; jest and `tsc`
   builds are unaffected.
5. **ioredis MULTI takes lowercase method names**; the first publish
   attempt failed on `RENAME` and, because `discard` used the same path,
   left `…:tmp:<runId>` hashes behind. Their 3600 s TTL is what cleans
   them up, which is exactly the case the TTL was added for.
6. `SIGINT` on an idle instance exits immediately; `releaseResources` is
   bounded at 30 s.

## 12. Code review round 1 — responses

Codex Code Reviewer (gpt-6-astra), REQUEST CHANGES. All seven critical items
fixed and covered by tests:

1. `RENAME` carries the staging TTL to the published hash — confirmed on the
   local Redis (`ttl=2788` on `UniswapV2:1` after the first run). Publish
   now runs a Lua script with `PERSIST` (§4.3); `FakeRedis` transfers TTLs
   on RENAME so the test would have caught it.
2. Staging expiry mid-run / MULTI not rolling back: `EXPIRE` refreshed on
   every write, publish aborts on `STAGING_MISSING` before touching meta.
3. Scan exceptions abandoned in-flight workers and `onBatch` rejections
   escaped: replaced the `Promise.race` loop with a fixed worker pool that
   drains before finalization; `processBatch` never rejects; a throwing
   callback fails the run.
4. `HLEN`/publish outside the failure lifecycle: finalization is inside it,
   `lastFailure` is written, the ambiguity of a lost EXEC ack is stated in
   the failure message.
5. `batchSize: 1.5` produced a 1001-descriptor request, `NaN` concurrency
   removed the cap: `Number.isSafeInteger` bounds on both.
6. Shared `LogCapture` across chains: independent windows, every event
   lands in all open ones (upper bound, as documented), closed in the error
   path too.
7. Negative `?sample=` made `HRANDFIELD` sample with replacement: integer
   `1..500` enforced.

Recommendations: `validateRow` accepts `unknown` and a non-array response is
one `invalid`; `/reserves` reads meta, rows and count in one MULTI;
`/verify` takes the run block from the published meta; readiness probes
yield `status: 'unready'`; `msetex` surfaces pipeline errors; `subscribe`
reference-counts channel listeners and logs subscription failures. The
`Promise.race` reaction accumulation is gone with the worker pool.

Codex confirmed `zadd` ordering, empty `hmset`, provider `this` binding,
`HRANDFIELD WITHVALUES` parsing and the bigint tolerance arithmetic. Tests:
32 in `consumer/` (from 23), covering TTL refresh and PERSIST, expired
staging, failed publish transaction, scan failure with active workers,
throwing callback, fatal stop, cross-batch duplicate, null / non-array
responses, non-integer parameters.

## 13. Code review round 2 — responses

Codex Code Reviewer (gpt-6-astra), REQUEST CHANGES: five of seven round-1
items confirmed fixed, two partially, one new race, one deployment
question.

- **Staging expiry between writes** recreated the hash with only the later
  batches: writes after the first now go through `WRITE_SCRIPT`, which
  aborts with `STAGING_MISSING` when the hash is gone (§4.3). Reproduced by
  the reviewer, now a unit test and a real-Redis test.
- **`onBatch` not awaited**: awaited; the callback type is `void |
Promise<void>`; an async rejection fails the run with no unhandled
  rejection (test listens for `unhandledRejection`).
- **`/verify` mixed runs**: metadata, `HRANDFIELD` sample and `HLEN` are
  read in one MULTI.
- **Non-array response** broke the accounting identity: counted as a failed
  batch with its fields skipped, so `requested = returned + invalid + skipped
  - duplicateFields` holds; test asserts the identity.
- **WooFi readiness** checked object presence: it now awaits
  `pollingPool.getState()` under a 10 s timeout.
- **Redis Cluster**: production is clustered (confirmed by the owner), so
  the keys carry a hash tag (D4). Kept to that one change; no client-side
  slot handling.
- **Tests**: the TTL test lowers the fake TTL between writes and expects
  the reset; the drain test faults the scan while one request is
  outstanding and asserts it completes before discard; added final `HLEN`
  failure and `publish.redis.test.ts`, an opt-in suite
  (`POOL_RESERVES_TEST_REDIS_URL`) that runs both Lua scripts against a real
  Redis, including a 1000-row write, so a missing `PERSIST` would be caught
  outside the hand-written fake. 42 tests in `consumer/` (from 32).

Re-run on the local production copy after the changes: Mainnet 48 dexes in
45 s, all `ok`, 61 800 rows published, published hashes `ttl=-1`, UniswapV2
`getReserves` 50/50 at the run block.
