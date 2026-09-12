# Pool reserves consumer simulation

Local harness that runs the pool-reserves consumer flow end to end against a
copy of the production Redis: discover every dex exposing `getPoolReserves`,
sweep the mode-A storages the production cluster wrote, call
`getPoolReserves` in batches, publish the result to
`dexlib:pools_reserves_legacy:{<dexKey>:<chainId>}` (the braces are a Redis Cluster hash tag so the hash, its `:meta`, `:tmp:<runId>` and `:lastFailure` share a slot) and make everything inspectable over HTTP. Plan and design notes:
`docs/pool-reserves-consumer-sim-plan.md`.

Two parts:

- `consumer/` — the sweep → collect → validate → publish logic, written as
  the reference implementation for the production consumer. No Express, no
  dex-lib internals; inputs are a `ConsumerRedis` (seven commands), a
  `getReserves(dexKey, pools?)` function and a `PoolsStorage`.
- `server/` — the harness: dex-lib in slave mode over the local Redis copy,
  initialization with explicit outcomes, RPC/log instrumentation, endpoints,
  verification oracles.

## Running

1. Load the dump (filters to the chains you need; ~4.6 GB for 1 + 8453):

   ```bash
   scripts/pool-reserves-server/redis-local.sh /path/to/dump.rdb 1,8453 6399
   ```

   Needs `redis-server` and [redis-rdb-cli](https://github.com/leonchen83/redis-rdb-cli)
   (`RCT=/path/to/rct`). RDB v10 (Redis 7.1) dumps load into redis-server 8.x.

2. Start the server (RPC URLs come from `HTTP_PROVIDER_<chainId>` in `.env`):

   ```bash
   POOL_RESERVES_CHAINS=1,8453 pnpm pool-reserves-server
   # one full pass over every chain, print the table, exit:
   pnpm pool-reserves-server -- --generate --exit
   ```

   | env                             | default                  | meaning                                               |
   | ------------------------------- | ------------------------ | ----------------------------------------------------- |
   | `POOL_RESERVES_REDIS_URL`       | `redis://127.0.0.1:6399` | the local copy, never production                      |
   | `POOL_RESERVES_PORT`            | `3400`                   | HTTP port                                             |
   | `POOL_RESERVES_CHAINS`          | `1,8453`                 | chain ids to initialize                               |
   | `POOL_RESERVES_MASTER_PREFIX`   | `is`                     | production `masterCachePrefix` (`is_<chain>_bn` keys) |
   | `POOL_RESERVES_CONCURRENCY`     | `3`                      | `getPoolReserves` batches in flight per dex           |
   | `POOL_RESERVES_BATCH_SIZE`      | `1000`                   | descriptors per batch (≤ `MAX_POOL_RESERVES_BATCH`)   |
   | `POOL_RESERVES_INIT_TIMEOUT_MS` | `120000`                 | per-dex `initializePricing` timeout                   |
   | `LOG_LEVEL`                     | `warn`                   | dex-lib log level on stdout                           |

   Consumer tests run with `pnpm test scripts/pool-reserves-server`; set `POOL_RESERVES_TEST_REDIS_URL=redis://127.0.0.1:6399` to also run the Lua publish/write scripts against a real Redis (`publish.redis.test.ts`).

   The npm script sets `TS_NODE_PREFER_TS_EXTS=true`: without it ts-node
   resolves `./bebop/bebop` to `bebop.json` and the `Dexes` array gets an
   undefined entry.

## Endpoints

A Postman collection with these requests and assertions for the invariants
(accounting identity, well-formed rows, ≥ 90 % oracle agreement, 400/404/409
paths) is in `pool-reserves-server.postman_collection.json`; import it and
set `baseUrl`, `chainId`, `dexKey`. Or run it headless:
`npx newman run scripts/pool-reserves-server/pool-reserves-server.postman_collection.json --folder "1. Discovery"`.

| route                                                         | what                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /health`                                                 | readiness per chain                                                                             |
| `GET /dexs/:chainId`                                          | every pool-reserve dex: mode, storage, init outcome, storage size before init and now           |
| `GET /pools/:dexKey/:chainId?cursor=&count=`                  | one HSCAN page of the storage (mode A) or of the last run's ids (mode B)                        |
| `GET /pools/:dexKey/:chainId/:id`                             | one descriptor                                                                                  |
| `GET /reserves/:dexKey/:chainId?cursor=&count=`               | last published run: `meta` (consumer report), `harness` (RPC counters, captured warnings), rows |
| `GET /reserves/:dexKey/:chainId/:id`                          | one row                                                                                         |
| `POST /generate/:chainId` / `POST /generate/:chainId/:dexKey` | run the consumer; 409 while a run is active on the chain                                        |
| `GET /status/:chainId`                                        | init outcomes, current/last run, all reports                                                    |
| `GET /verify/:dexKey/:chainId?sample=50`                      | on-chain oracle check (below)                                                                   |

## Reading a report

`meta` is the consumer's own `CollectStats`; the harness adds `rpc`,
`warnings` and `poolsInStorageBeforeInit`.

- `scannedFields = requested + unparsable`; `requested = returned + invalid + skipped + duplicateFields`.
  Anything else is a consumer bug.
- `skipped`: descriptors the dex did not answer for. For UniswapV2-family
  storages most of these are pairs the factory reported as non-existent
  (`checkExistenceAfter` without `exchange`), which the dex drops without
  RPC. Look them up with `/pools/:dexKey/:chainId/:id`.
- `unexpectedId`: rows whose id was not requested — dropped, never
  persisted. `invalid`: rows violating the `PoolReserves` contract.
- `failedBatches`: `getPoolReserves` rejected (dex-lib logs and returns `[]`
  on its own failures, so this is rare; the swallowed ones show up in
  `warnings`, which dex-lib's log output is the only source of).
- `status: 'failed'`: the run built a request dex-lib refused
  (`PoolReservesRequestError`) or Redis writes failed; the previous
  published result is untouched and the report is under `…:lastFailure`.
- `rpc.jsonRpcRequests` counts network requests made through the helper's
  ethers and web3 providers during this dex's run; `multicallSubCalls` the
  calls inside them. Background timers of other dexes can add to a window.
- `poolsInStorageBeforeInit` vs `poolsInStorage`: PoolsWriter dexes
  (Ekubo, Maverick, Algebra, AlgebraIntegral) publish on slaves too, so a
  storage that was empty in the dump fills up locally. Only the pre-init
  number is production input.

## Verification oracles (`/verify`)

- UniswapV2 family: `getReserves()` on the pair at the run block; a mismatch
  is re-read at latest (a swap in between).
- Token-pool dexes (Maverick, Algebra families): `balanceOf(pool)` per token
  at the run block, then at the pool's state block (`getStateBlockNumber()`
  of the in-memory pool — state-path values are exact there), then latest.
- EkuboV3: published ids must equal the pool manager's valid pools; TVL is
  virtual and has no balance oracle.
- Directional / unlimited rows (mode B): no generic oracle, reported as
  `unverified` with the reason.

Run `/verify` right after `/generate`: dexes that refresh state on a timer
(MaverickV2) move their state block past the run block within seconds, after
which stored values legitimately lag the chain. An empty mode-B result is
not automatically wrong: Aave GSMs that are seized or frozen are omitted by
specification (both Mainnet GSMs were seized at the time of the first run).

## Porting `consumer/` to the production service

- Implement `ConsumerRedis` over your client (see `toConsumerRedis` in
  `server/redis-cache.ts` for the ioredis one: `hlen`, `hscan`, `hset`,
  `expire`, `del`, `transaction` — MULTI/EXEC of raw commands — and `eval`, used for the write and publish scripts so a vanished staging hash aborts the run and RENAME + PERSIST + meta are atomic). Keys of one dex/chain share a hash tag, so a Cluster client works without extra slot handling.
- Bind `getReserves` to `POST /pool-reserves { dexKey, pools }` and pass
  `isRequestError` for the 400 response.
- Call `collectReserves` per dex, sequentially per chain; `concurrency`
  bounds in-flight batches. Memory is O(batchSize × concurrency).
- Keep the dex-lib logs: RPC failures inside `getPoolReserves` are not
  visible in the consumer's return values.
