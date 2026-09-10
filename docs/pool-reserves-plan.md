# Pool Reserves API — Design & Implementation Plan

Status: proposal, revision 8 (review rounds 1–4 applied; directional reserve keys; scope cut by volume for storage-mode dexes; all SimpleExchange dexes included in enumerated mode; request-level versioning dropped after PR 1 review)
Repo: `paraswap-dex-lib`
Date: 2026-09-09

## 1. Goal

Expose, for every supported DEX, the set of pools that are currently usable for
swaps together with their per-token reserves, so that an external service can
build and refresh a reserves dataset (e.g. `{ "0xtoken": "12345", ... }` per pool).

The external consumer must be able to:

1. Discover **all known pools** of a DEX cheaply, without going through the
   pricing API.
2. Ask the pricing API for **reserves of an arbitrary subset of those pools**,
   choosing its own cadence and batch size.
3. For DEXes with a handful of pools, get **all pools with reserves in one
   call**, with no discovery step.

Precision requirement: **approximate reserves are acceptable.** The dataset is
used for liquidity analysis, not for pricing. A pool that is a few blocks stale,
or a pool that is missing from one response, is fine. Wrong units or reserves
attributed to the wrong pool are not.

## 2. Scope selection by volume

Source: `docs/dex-volumes-by-exchange-by-chain-2m-2026-09-09.json` (Redshift
`psa_volumes`, 2026-07-09 → 2026-09-09, per chain and exchange key).

Rules applied:

- Exchange keys written entirely in lowercase (`uniswapv3`, `pancakeswapv3`,
  `curvev1stableng`, `fluiddex`, `metric`, `aerodromeslipstream`, …) are served
  by a different service and are **not counted at all**. Remaining dex-lib
  volume for the period: **1 456 M$**.
- Volume is aggregated per **dex-lib class**, not per dex key: one
  implementation in `UniswapV2` or `Solidly` covers every fork key for free.
- **Threshold for storage-mode classes (§5, mode A): ≥ 5 M$ per 2 months per
  class** (≈ 0.34 % of dex-lib volume). Classes below it are not implemented
  now; they can be added later with the same interface.
- **Enumerated-mode classes (§5, mode B) are included regardless of volume.**
  They are `SimpleExchange` dexes with a config-defined pool set, and their
  `getTopPoolsForToken` already encodes the reserve semantics
  (`UNLIMITED_USD_LIQUIDITY` / `NO_USD_LIQUIDITY` / a real number), so the
  implementation is a few lines each.
- Classes whose pools come from a protocol API (Curve, Balancer V3) or are
  handled elsewhere (RFQ) are excluded regardless of volume.

### 2.1 In scope — storage mode (mode A, ≥ 5 M$)

| Class            | Keys                                                                                             | Volume, M$ | Share |
| ---------------- | ------------------------------------------------------------------------------------------------ | ---------: | ----: |
| EkuboV3          | EkuboV3                                                                                          |       78.1 | 5.4 % |
| MaverickV2       | MaverickV2                                                                                       |       27.3 | 1.9 % |
| Algebra          | SwaprV3, CamelotV3, QuickSwapV3                                                                  |       17.9 | 1.2 % |
| UniswapV2 family | UniswapV2, RingV2, PancakeSwapV2, SushiSwap, QuickSwap, PangolinSwap, TraderJoe, + 10 minor keys |       13.0 | 0.9 % |
| AlgebraIntegral  | BlackholeCL, QuickSwapV4, Supernova                                                              |       10.4 | 0.7 % |
| Solidly family   | Aerodrome, VelodromeV2, + 6 minor keys                                                           |        7.4 | 0.5 % |

### 2.2 In scope — enumerated mode (mode B, all volumes)

| Class                      | Keys                                                                                                         | Volume, M$ | Reserve semantics today (`getTopPoolsForToken`)                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------: | ---------------------------------------------------------------- |
| LitePsm                    | LitePsm                                                                                                      |      716.3 | real: `min(gemBalance, daiBalance)` per side                     |
| Weth                       | Weth, Wxdai, Wbnb, Wavax, Wmatic, wS, Wxpl                                                                   |       41.6 | returns `[]`; both directions unlimited by construction          |
| wstETH                     | wstETH                                                                                                       |       34.2 | `UNLIMITED`                                                      |
| ERC4626                    | sUSDe, sDAI, wsuperOETHb, stcUSD, yoETH, yoUSD, wOUSD, wUSDL, wOETH, wOS, sftUSD, fUSDT0, eUSDT0, waPlaUSDT0 |       30.8 | `UNLIMITED` / `NO` gated by deposit/redeem allowed               |
| Spark                      | Spark, sUSDS                                                                                                 |       24.3 | `UNLIMITED`                                                      |
| WooFiV2                    | WooFiV2                                                                                                      |       19.1 | real: poller `tokenInfos[t].reserve`                             |
| OSwap                      | OSwap                                                                                                        |        8.3 | real: `balance0/balance1`                                        |
| AaveV3                     | AaveV3                                                                                                       |        7.7 | `UNLIMITED`                                                      |
| SkyConverter               | DaiUsds, MkrSky                                                                                              |        7.6 | `UNLIMITED` / `NO` per configured direction                      |
| UsdcTransmuter             | UsdcTransmuter                                                                                               |        4.7 | `UNLIMITED`                                                      |
| SparkPsm                   | SparkPsm                                                                                                     |        3.3 | `UNLIMITED`                                                      |
| Cap                        | Cap                                                                                                          |        1.0 | `UNLIMITED` for every vault/asset pair                           |
| Usual family               | UsualBond, UsdcUsualUSDC, UsualUSDCUsd0, UsualMWrappedM, UsualMUsd0, MWrappedM, WrappedMM                    |        0.4 | `UNLIMITED` one way, `NO` reverse                                |
| AngleTransmuter            | AngleTransmuter                                                                                              |       0.04 | real USD sum for the stablecoin side, `UNLIMITED` for collateral |
| PolygonMigrator            | PolygonMigrator                                                                                              |       0.01 | returns `[]`; both directions unlimited                          |
| Swell                      | Swell                                                                                                        |      0.003 | returns `[]`; one-way mint                                       |
| dETH                       | dETH, dBNB, dPOL                                                                                             |      0.002 | `UNLIMITED`                                                      |
| AaveV3Stata, AaveV3StataV2 | AaveV3Stata, AaveV3StataV2                                                                                   |          0 | `UNLIMITED`                                                      |
| StkGHO                     | StkGHO                                                                                                       |          0 | `UNLIMITED` GHO→stkGHO, `NO` reverse                             |
| FxProtocolRusd             | FxProtocolRusd                                                                                               |          0 | `UNLIMITED`                                                      |
| AaveV3PtRollOver           | AaveV3Pendle                                                                                                 |          0 | `UNLIMITED` / `NO` per direction, per PT market                  |
| UsualPP                    | UsualPP                                                                                                      |          0 | `UNLIMITED`                                                      |
| AaveGsm                    | AaveGsm                                                                                                      |          0 | real: `underlyingLiquidity`                                      |
| MiroMigrator               | MiroMigrator                                                                                                 |          0 | hardcoded 1e9 / `NO`; state holds real `balance`                 |
| AngleStakedStable          | AngleStakedStableUSD, AngleStakedStableEUR                                                                   |          0 | `UNLIMITED`                                                      |

Total covered by both modes: **1 062 M$ ≈ 73 % of dex-lib volume**.

### 2.3 Dropped by volume (storage-mode candidates < 5 M$ / 2 months)

BalancerV2 2.5, Ekubo (v1) 1.7, Nerve family (Synapse, IronV2, Nerve) 1.1,
SolidlyV3 1.0, BalancerV1 0.2, Camelot (v2) 0.1, MaverickV1 0.

### 2.4 Excluded regardless of volume

- Served by another service (lowercase keys): Uniswap V3/V4 and all forks,
  Curve StableNg, FluidDex, FluidDexLite, Metric, PancakeSwapInfinity, Tessera,
  Velodrome/Aerodrome Slipstream, Pharaoh V3, Pangolin V3, Okutrade, Kipseli, …
- Protocol API is the source: CurveV1, CurveV1Factory, CurveV2 (Curve API);
  Balancer V3 (`api-v3.balancer.fi`, `poolGetPools { poolTokens { address balance } }`
  — verified 2026-09-09 to return per-token balances for `protocolVersion: 3`).
- RFQ / off-chain: Native, Dexalot, Hashflow, Bebop, SwaapV2, GenericRFQ
  (ParaSwapPool\*), ParaSwapLimitOrders, AugustusRFQ.
- Tx-builder-only legacy classes that do not implement `IDex` and have no
  `getTopPoolsForToken`: Lido (7.1 M$), EtherFi, StablePool, DodoV1,
  TraderJoeV2.2. Lido would be a one-line `UNLIMITED` mode-B adapter if it is
  ever migrated to `IDex`.

## 3. Background: how state lives today

- Pricing runs on **slave** instances (`dexHelper.config.isSlave === true`)
  behind a load balancer. A master (initialization) service exists today but
  is scheduled for removal, so nothing new may depend on it.
- Event-based DEXes keep pool state in memory via `StatefulEventSubscriber`
  (`src/stateful-event-subscriber.ts`): `getState(bn)`, `getStaleState()`,
  `getStateBlockNumber()`, `isInvalid()`.
- Most AMMs create pool objects **lazily**: a pair/pool exists in memory only
  after it was priced at least once on that instance (`UniswapV2.pairs`,
  `Solidly.pairs`, `Algebra.eventPools`, `AlgebraIntegral.eventPools`).
- `UniswapV2RpcPoolTracker` (PancakeSwapV2, ~2M pools) tracks every factory
  pool; `SolidlyRpcPoolTracker` (VelodromeV2, Equalizer, PharaohV1, Blackhole)
  populates its list only in `updatePoolState`, i.e. on the pool-tracker
  service, and is empty on slaves.
- Existing Redis pool lists:
  - `UniswapV2` (and Solidly + all Solidly forks, which reuse it): hash
    `${CACHE_PREFIX}_${network}_${dexKey}_pairs`, field = pool identifier,
    value = `{ token0, token1, exchange, checkExistenceAfter }`, `exchange`
    is the pair address or `null` (`src/dex/uniswap-v2/uniswap-v2.ts:291`,
    `src/dex/solidly/solidly.ts:201,276`). Written by every instance.
  - `UniswapV2RpcPoolTracker` (PancakeSwapV2): hash
    `${CACHE_PREFIX}_${network}_${dexKey}_pools`, field = factory index,
    value = `CachedPool { address, updatedAt, token0, token1 }` — **no
    reserves** (`src/dex/uniswap-v2/rpc-pool-tracker.ts:14`). In-memory
    entries start with `reserve0 = reserve1 = 0n`, `reservesUpdatedAt = null`;
    reserves are refreshed only for the top 2000 pools. Writer runs on master.
- `getTopPoolsForToken` / `updatePoolState` run on the pool-tracker service
  without `blockManager` or event state (CLAUDE.md Fix Log), so they cannot
  source reserves.
- `MultiWrapper.tryAggregate(mandatory, calls)` (`src/lib/multi-wrapper.ts:54`)
  gives non-reverting multicall with per-call success flags.

## 4. Rejected alternative

A single zero-argument `getPoolReserves()` for **every** dex was rejected:
PancakeSwapV2 alone has ~2M pools, the consumer would have no control over
cadence or batch size, and lazy dexes would return a partial,
instance-dependent set. The zero-argument form is kept only for dexes with a
small, config-defined pool set (§5, mode B).

## 5. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Rationale                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | One optional method `getPoolReserves(pools?)` with two modes selected by `getPoolsStorage()`. **Mode A (storage):** `getPoolsStorage()` returns a Redis location; `getPoolReserves(pools)` computes reserves for the given descriptors. **Mode B (enumerated):** `getPoolsStorage()` is absent or returns `null`; `getPoolReserves()` with no arguments returns every pool.                                                                                                                                                                                                                                                                                                                                                                                                   | Large / lazy pool sets need consumer-driven batching; wrappers with a handful of pools do not need discovery at all.                                                                                                                            |
| D2  | Mode A pool lists live in **Redis**, read by the consumer directly. The API only publishes `{ key, type, fieldInValue }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Avoids paginating millions of pools through the API.                                                                                                                                                                                            |
| D3  | Storage is **typed** (`PoolsStorageType`, currently `redis-hash`) but **not versioned**. An incompatible descriptor change is published under a **new Redis key**; the consumer follows whatever key `/pools-storages` advertises. Descriptors that do not parse are skipped (D8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A request-level version cannot help: during a rollout old and new instances write into the same hash, so any batch mixes shapes regardless of the number the consumer echoes. Both services ship from this repo; the key is the version.        |
| D4  | Hash values are **dex-owned opaque JSON descriptors**, strictly minimal. The consumer passes them back verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pool identity differs per protocol; schema stays local to the dex.                                                                                                                                                                              |
| D5  | Reuse existing Redis structures (`_pairs`, `_pools`). New structures only where nothing exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | No duplicated writes; no new master responsibilities.                                                                                                                                                                                           |
| D6  | Runs on **slave instances only**. Sources: in-memory state when the pool exists on this instance and is not invalid; otherwise batched non-reverting multicall (mode A) or direct multicall (mode B wrappers without state). No master state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Master is being deprecated.                                                                                                                                                                                                                     |
| D7  | `MAX_POOL_RESERVES_BATCH = 1000` descriptors per mode-A call, enforced centrally; multicalls chunked. Mode B is bounded by config size (≤ ~50 pools).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | RPC quota is shared across instances.                                                                                                                                                                                                           |
| D8  | Per-pool failure isolation: unknown, unparsable, `exchange: null`, invalid-state or RPC-failed pools are **skipped**; `tryAggregate(false, …)` with per-pool decode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | One reverting token must not lose the batch.                                                                                                                                                                                                    |
| D9  | No `block` / `updatedAt` in responses. Stale-but-valid in-memory state is returned as-is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Approximate reserves acceptable; caller stamps.                                                                                                                                                                                                 |
| D10 | Each result carries `id` (mode A: the hash field; mode B: pool address or a dex-defined stable id) plus `address`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Ekubo pools share one core contract; skipped descriptors break positional mapping.                                                                                                                                                              |
| D11 | Mode A storages are written by slaves: known-up-front sets in `initializePricing` and on every runtime refresh; lazily created pools through a shared buffered writer (`hmset`, periodic flush). Entries carry last-seen `u`; the writer re-touches all in-memory pools each flush and prunes entries older than 30 days (`hscan` + `hdel`).                                                                                                                                                                                                                                                                                                                                                                                                                                  | No per-call Redis writes; bounded growth.                                                                                                                                                                                                       |
| D12 | Writer/pruner cross-instance races are **accepted** (self-healing via re-touch; `u` drift ≤ one flush interval against a 30-day threshold).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Low probability; precision not required.                                                                                                                                                                                                        |
| D13 | Reserve semantics per adapter = the **simplest correct-units** definition. Hit and miss paths may differ slightly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Precision not required; complexity is the cost.                                                                                                                                                                                                 |
| D14 | Storage-mode scope is cut by volume as in §2; every `SimpleExchange` dex is included in enumerated mode; lowercase keys are ignored entirely.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Effort goes where the volume is; enumerated adapters cost a few lines each.                                                                                                                                                                     |
| D15 | A reserve value is **the payout capacity of the output token of a supported swap**. Three values: a raw balance string; `UNLIMITED_RESERVES` when the swap is a mint/convert with no cap; `'0'` when the swap is supported but currently has nothing to pay out (e.g. GSM at `exposureCap`). Unsupported swaps are never represented by a value — they are absent (D17). The key shape (plain token or `src_dest`) is defined in D17. The existing tracker is only a hint: `getTopPoolsForToken(in).liquidityUSD` describes swaps **from** `in`, so its `UNLIMITED` belongs to the swap `in → connector`, and several trackers are wrong about direction support (UsualPP, Stata). The **pricing guards in `getPricesVolume`** are the source of truth for which swaps exist. | One rule for all dexes; `'0'` and "absent" carry different information.                                                                                                                                                                         |
| D16 | `UNLIMITED_RESERVES` is a dedicated string constant (`'unlimited'`), not the numeric `UNLIMITED_USD_LIQUIDITY` (1234567890).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `reserves` values are raw token units; a numeric magic value could collide with a real balance.                                                                                                                                                 |
| D17 | `reserves` keys come in two shapes, never mixed within one pool. **Plain** `token` keys mean every listed token can be swapped to every other listed token in both directions, and the value is the payout capacity of that token (classic AMM). **Directional** `src_dest` keys enumerate exactly the supported swaps, and the value is the payout capacity of `dest` for that swap. A direction that is not supported simply has no key.                                                                                                                                                                                                                                                                                                                                    | One-way and partially-connected pools (Usual, SkyConverter, LitePsm `dai ↔ usds`, ERC4626 with redeem disabled) cannot be expressed with per-token values; a missing key is unambiguous where `'0'` is not (GSM at cap is supported but empty). |

## 6. Public contract

```ts
// src/types.ts
export enum PoolsStorageType {
  RedisHash = 'redis-hash',
}

export type PoolsStorage = {
  key: string;             // Redis key
  type: PoolsStorageType;  // how to read it
  fieldInValue: boolean;   // true: the dex can derive the hash field from the value;
                           // false: consumer must send `{ i: field, ...value }`
};

// src/constants.ts
export const UNLIMITED_RESERVES = 'unlimited';

export type PoolReserves = {
  dex: string;                        // dexKey
  id: string;                         // mode A: hash field; mode B: dex-defined stable id
  address: Address;                   // pool / contract address (lowercase)
  reserves: Record<string, string>;   // key: `token` (plain, bidirectional among all listed tokens)
                                      //   or `srcToken_destToken` (directional, exactly this swap)
                                      // value: raw payout capacity of the output token
                                      //   (decimal string), UNLIMITED_RESERVES, or '0'
};

// Plain example (AMM pair): { "0xa…": "123", "0xb…": "456" }
// Directional example (one-way converter): { "0xa…_0xb…": "unlimited" }
// Directional example (PSM): { "0xgem_0xdai": "…", "0xdai_0xgem": "…", "0xgem_0xusds": "…", "0xusds_0xgem": "…" }

// src/dex/idex.ts — added to IDexPooltracker
getPoolsStorage?(): PoolsStorage | null;
getPoolReserves?(pools?: string[]): AsyncOrSync<PoolReserves[]>;
```

`DexAdapterService.getPoolReservesByKey(dexKey, pools?)`:

- dex has a non-null storage → `pools` is required, batch size is validated,
  call is forwarded;
- dex has no storage → `pools` must be absent, `getPoolReserves()` is called.

Consumer flow:

1. `GET /pools-storages` → `{ [dexKey]: PoolsStorage | null }` for every dex
   implementing `getPoolReserves`. `null` means "call without pools".
2. Mode A: `HSCAN key`, then `POST /pool-reserves { dexKey, pools }` in
   batches ≤ 1000. Missing `id`s in the response mean "skipped".
3. Mode B: `POST /pool-reserves { dexKey }`.
4. Consumer stores results with its own timestamp / block.

## 7. Implementation plan

### PR 1 — core (no dex changes)

| File                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                           | `PoolsStorageType`, `PoolsStorage`, `PoolReserves`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/dex/idex.ts`                        | two optional methods on `IDexPooltracker`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/constants.ts`                       | `UNLIMITED_RESERVES = 'unlimited'`, `MAX_POOL_RESERVES_BATCH = 1000`, `POOLS_STORAGE_PRUNE_AGE_MS = 30d`, `POOLS_STORAGE_FLUSH_INTERVAL_MS = 60s`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/dex/index.ts` (`DexAdapterService`) | `getPoolsStorages()`, `resolvePoolReservesCall(dexKey, pools?)` (synchronous validation, throws `PoolReservesRequestError`), `getPoolReservesByKey(dexKey, pools?)` with the mode rules above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/pricing-helper.ts`                  | thin wrappers with timeout + try/catch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/dex-helper/icache.ts` + impls       | `hscan(key, cursor, count)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lib/pools-storage/pools-writer.ts`  | `PoolsWriter { touch, flush, prune, release }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/lib/pools-storage/reserves.ts`      | `toReserves(tokens, balances)` (plain keys); `directionalReserves([{ src, dest, capacity: bigint \| 'unlimited' }])` (directional keys, D17); `multicallBalances(multiWrapper, calls, chunkSize)` returning `(bigint \| null)[]` — chunks locally and calls `tryAggregate(false)` **per chunk inside its own try/catch** (a failed RPC chunk yields `null` for its calls only, since `MultiWrapper.tryAggregate` rejects as a whole when any chunk fails), and **each `decodeFunction` is wrapped in its own try/catch**, because `tryAggregate` (`src/lib/multi-wrapper.ts:112`) only isolates reverts and lets a decoder exception on one successful-but-malformed return propagate for the whole batch; `PoolReservesRequestError` for malformed requests |
| `src/index.ts`                           | export new types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tests                                    | unit: writer touch/flush/prune/release, `toReserves`, `directionalReserves`, `multicallBalances` with (a) one reverting call and (b) one successful call returning malformed data among valid calls, (c) one failed RPC chunk among successful chunks, mode selection in `DexAdapterService`, `PricingHelper` error boundary (request errors propagate, dex errors and timeouts → `[]`); shared `expectPoolReserves()` helper that also validates key shape (all plain or all directional per pool)                                                                                                                                                                                                                                                          |

### PR 2 — UniswapV2 + Solidly families (mode A, ~25 keys)

Storage: existing `_pairs` hash, `fieldInValue: true` (field is the
pool identifier derived from `token0`/`token1`). Solidly and all Solidly forks
inherit the storage but **override id derivation**: `Solidly.getPoolIdentifier`
(`src/dex/solidly/solidly.ts:714`) takes `(token0, token1, stable)` and the
hash field embeds the flag, so the descriptor's `stable` must be passed
through or a stable pool would resolve to the volatile pool's id and state.
For the Solidly RPC-tracker forks this storage contains only pairs that were
priced at least once; accepted (their volume is negligible).

`getPoolReserves(descs)` in `src/dex/uniswap-v2/uniswap-v2.ts`:

1. Parse; skip `exchange == null`; `id` = `this.getPoolIdentifier(...)` with
   the descriptor's fields (UniswapV2: `token0`, `token1`; Solidly: plus
   `stable`).
2. Hit: `this.pairs[key]?.pool` exists and `!isInvalid()` → `getStaleState()`
   → `reserves0/reserves1`.
3. Miss: `multicallBalances` on `pair.getReserves()`; failures skipped.
4. `toReserves([token0, token1], [r0, r1])`.

Overrides:

- `UniswapV2RpcPoolTracker` (PancakeSwapV2): `getPoolsStorage()` → existing
  `_pools` hash with `fieldInValue: false` (field = factory index). Hit only
  when the entry exists **and** has reserves:
  `const p = this.pools[idx]; if (p && p.reservesUpdatedAt != null)` — on
  slaves the tracker map is usually empty, and `undefined !== null` would
  otherwise count a missing entry as a hit. Otherwise parent miss path.
  Master-gated writer untouched.
- `BiSwap`, `RingV2`: inherit.

### PR 3 — storage-mode AMMs

| Dex              | Storage                                                                                                                                                                                                                                                                                                                                                                                             | In-memory hit       | Miss / fallback | Completeness |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------- | ------------ |
| ekubo-v3         | new `_pools` hash; `{ k: stringId, t0, t1 }`, `fieldInValue: true` (`k` is the field). Written from `EkuboV3PoolManager.setPool()` (`ekubo-v3-pool-manager.ts:815`), which is the single insertion point for both the initial `updatePools` load and runtime `PoolInitialized` events — there is no periodic refresh on pricing instances (`updatePoolState` runs on the pool-tracker service only) | `pool.computeTvl()` | skip            | full         |
| maverick-v2      | init-time from subgraph list; `{ a, tA, tB }`                                                                                                                                                                                                                                                                                                                                                       | `reserveA/reserveB` | `balanceOf` ×2  | full         |
| algebra          | lazy via `PoolsWriter`; `{ a, t0, t1 }`                                                                                                                                                                                                                                                                                                                                                             | `balance0/balance1` | `balanceOf` ×2  | observed     |
| algebra-integral | lazy via `PoolsWriter`; `{ a, t0, t1 }`                                                                                                                                                                                                                                                                                                                                                             | `balance0/balance1` | `balanceOf` ×2  | observed     |

### PR 4 — enumerated mode: every `SimpleExchange` dex (mode B)

All return every pool in one call; nothing is written to Redis. `id` = pool /
contract address, plus a token suffix where one contract serves several pairs.
Each adapter follows D15 + D17 with an **explicit direction set** taken from
its `getPricesVolume` guards (not from `getPoolIdentifiers`, which several
dexes return unconditionally, and not from `getTopPoolsForToken`, whose flags
describe the input side). Plain keys are used only when every listed token
swaps to every other listed token in both directions; otherwise directional
`src_dest` keys enumerate the supported swaps and unsupported ones have no
key. `'0'` is reserved for a supported swap with zero capacity right now.
Pools whose state marks them unusable (frozen, seized, paused) are omitted.

| Dex                                               | Pools                                              | `reserves`                                                                                                                                                                                                                                                                                           | Source                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| lite-psm                                          | one per gem PSM config, `id` = DAI PSM address     | directional: `{ gem_dai: daiBalance, dai_gem: gemBalance, gem_usds: daiBalance, usds_gem: gemBalance }` — the USDS path (`usdsPsm`, `lite-psm.ts:225`) is a 1:1 wrapper over the same DAI PSM, so both stablecoins are paid out of `daiBalance`; `dai ↔ usds` is not a supported pair and has no key | event state + config                                                                                                         |
| oswap                                             | one per pool config                                | plain: `{ t0: balance0, t1: balance1 }`                                                                                                                                                                                                                                                              | event state; pools this instance has not priced yet are generated once via `updatePoolState` (no `initializePricing` exists) |
| woo-fi-v2                                         | single pool                                        | plain: `{ t: tokenInfos[t].reserve }` for every token                                                                                                                                                                                                                                                | poller state                                                                                                                 |
| aave-gsm                                          | one per GSM; omitted when `isFrozen \|\| isSeized` | directional: `{ gho_underlying: underlyingLiquidity, underlying_gho: toGho(max(exposureCap - underlyingLiquidity, 0)) }` — remaining sell capacity converted to GHO units with the same rate math pricing uses; `'0'` at the cap, never `UNLIMITED`                                                  | event state                                                                                                                  |
| miro-migrator                                     | single pool                                        | directional: `{ psp_vlr: balance, sepsp1_vlr: balance }` — both sources draw on the same VLR balance; BSC has no sePSP1                                                                                                                                                                              | event state                                                                                                                  |
| erc4626                                           | one per vault key                                  | directional: `{ asset_vault: UNLIMITED, vault_asset: totalAssets if redeemAllowed(state) }`; deposit is always allowed, redeem is gated by the sUSDe cooldown (`withdrawDisabled` only affects BUY, which does not remove the direction)                                                             | event state + config flags                                                                                                   |
| angle-transmuter                                  | one per stablecoin, `id` = transmuter              | directional: `{ collateral_i_stable: UNLIMITED, stable_collateral_i: collateral_i.balanceOf(transmuter) }` per collateral; a collateral whose balance call fails keeps only the mint key                                                                                                             | `multicallBalances` over `eventPools[fiat].config.collaterals` (the USD sum lives on the pool-tracker service only)          |
| weth (Weth, Wxdai, Wbnb, Wavax, Wmatic, wS, Wxpl) | single pool                                        | plain: `{ native(0xeeee…): UNLIMITED, wrapped: UNLIMITED }`                                                                                                                                                                                                                                          | config                                                                                                                       |
| wsteth                                            | single pool                                        | plain: `{ stETH: UNLIMITED, wstETH: UNLIMITED }`                                                                                                                                                                                                                                                     | config                                                                                                                       |
| spark (Spark, sUSDS)                              | single pool per key                                | plain: `{ asset: UNLIMITED, share: UNLIMITED }`                                                                                                                                                                                                                                                      | config                                                                                                                       |
| spark-psm                                         | single pool                                        | plain over the 3 PSM3 assets, all `UNLIMITED`                                                                                                                                                                                                                                                        | config                                                                                                                       |
| aave-v3                                           | one per (underlying, aToken) from `tokens.ts`      | plain: `{ underlying: UNLIMITED, aToken: UNLIMITED }`                                                                                                                                                                                                                                                | token list                                                                                                                   |
| aave-v3-stata, aave-v3-stata-v2                   | one per stata token                                | directional, four keys: `underlying_stata`, `stata_underlying`, `aToken_stata`, `stata_aToken`, all `UNLIMITED`; **no** `underlying ↔ aToken` (pricing requires one side to be the stata token, `aave-v3-stata-v2.ts:174`)                                                                           | token list                                                                                                                   |
| aave-v3-pt-roll-over                              | single pool, `id` = old PT market                  | directional: `{ oldPT_newPT: UNLIMITED }` — the only route `isAppropriatePair` accepts                                                                                                                                                                                                               | config                                                                                                                       |
| sky-converter (DaiUsds, MkrSky)                   | single pool                                        | directional: `old_new: UNLIMITED` if `oldToNewFunctionName`, `new_old: UNLIMITED` if `newToOldFunctionName`                                                                                                                                                                                          | config                                                                                                                       |
| usdc-transmuter                                   | single pool                                        | plain: `{ usdc: UNLIMITED, usdce: UNLIMITED }`                                                                                                                                                                                                                                                       | config                                                                                                                       |
| cap                                               | one per (vault, asset), `id` = `vault_asset`       | directional: `{ asset_vault: UNLIMITED, vault_asset: assetSupply[asset] }` — burn pays out of the vault's supply of that asset                                                                                                                                                                       | `AllVaultConfigs` + event state                                                                                              |
| usual family (7 keys)                             | single pool per key                                | directional: `{ fromToken_toToken: UNLIMITED }` — one-way; the tracker puts `UNLIMITED` on `fromToken` because it describes the input side                                                                                                                                                           | config                                                                                                                       |
| usual-pp                                          | single pool                                        | directional: `{ USD0++_USD0: UNLIMITED }` — pricing supports only USD0++ → USD0 (`isValidTokens`, SELL only) even though the tracker reports `UNLIMITED` both ways                                                                                                                                   | config                                                                                                                       |
| stk-gho                                           | single pool                                        | directional: `{ gho_stkGHO: UNLIMITED }`                                                                                                                                                                                                                                                             | config                                                                                                                       |
| fx-protocol-rusd                                  | single pool, `id` = rUSD                           | plain: `{ weETH: UNLIMITED, rUSD: UNLIMITED }`                                                                                                                                                                                                                                                       | config                                                                                                                       |
| deth (dETH, dBNB, dPOL)                           | single pool                                        | directional: `eth_d`, `weth_d`, `d_eth`, `d_weth`, all `UNLIMITED` — plain keys would imply `eth <-> weth`, which the dex does not price                                                                                                                                                             | config                                                                                                                       |
| angle-staked-stable                               | single pool per key                                | directional: `{ ag_stake: UNLIMITED, stake_ag: totalAssets }`                                                                                                                                                                                                                                        | event state                                                                                                                  |
| polygon-migrator                                  | single pool                                        | plain: `{ matic: UNLIMITED, pol: UNLIMITED }`                                                                                                                                                                                                                                                        | config                                                                                                                       |
| swell                                             | one per (swETH, rswETH)                            | directional: `{ eth_share: UNLIMITED, weth_share: UNLIMITED }` — `isEligibleSwap` accepts ETH or WETH as source                                                                                                                                                                                      | config                                                                                                                       |

Where the event state holds a real balance or cap that today is only used for
pricing (aave-gsm, miro-migrator, erc4626 `totalAssets`), the real number is
reported because it costs nothing. Everything else is a D15 mapping of the
supported swap directions, with each adapter's table row as the spec.

## 8. Descriptor conventions (mode A)

- JSON object, short keys: `a` = pool address, `t`/`t0`/`t1`/`tA`/`tB` =
  token addresses, `k` = protocol pool key string (Ekubo), `u` = last-seen ms
  (writer-managed storages only). Addresses lowercase. Nothing else.
- Each descriptor lets the dex recompute its hash field (`id`) without a
  Redis read; when it cannot (PancakeSwapV2's index-keyed `_pools`),
  `fieldInValue: false` tells the consumer to wrap `{ i: field, ...value }`.
- An incompatible descriptor change is published under a new Redis key (e.g.
  `_pools_v2`); the old key is left to expire with its writers. Descriptors
  that do not parse are skipped.
- Existing structures (`_pairs`, `_pools`) keep their current value shape.

## 9. Risks & accepted trade-offs

| Risk                                                 | Handling                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Consumer drives RPC load through the API             | D7 batch cap + chunked multicalls; hits served first; mode B bounded by config size.              |
| One reverting token kills a batch                    | D8.                                                                                               |
| Stale in-memory state                                | Accepted (D9); invalid state skipped.                                                             |
| Hit/miss quantity drift                              | Accepted (D13); UniV2 miss uses `getReserves()` so both paths agree anyway.                       |
| Unbounded growth of lazy storages                    | D11 pruning.                                                                                      |
| Writer/pruner races                                  | Accepted (D12).                                                                                   |
| Consumer coupled to Redis schema                     | D3 typed; descriptors opaque; incompatible changes get a new key; unparsable descriptors skipped. |
| PancakeSwapV2 `_pools` writer is master-only         | Out of scope; read path unaffected; flagged for master deprecation.                               |
| `HGETALL` on a 2M-entry hash                         | Consumer must `HSCAN`; documented.                                                                |
| Solidly RPC-tracker forks expose only observed pairs | Accepted; < 0.1 M$ volume.                                                                        |

## 10. Verification

- Each PR: `pnpm checks` and unit tests.
- Unit: writer touch/flush/prune/release; `toReserves`; `multicallBalances`
  with one failing call among valid ones and one failed chunk; mode selection.
- Dex integration tests (CI only) extended with a `getPoolReserves` case:
  known-liquid pool returns non-zero reserves for both tokens; invalid or
  unknown descriptor skipped without failing the batch; EkuboV3 returns
  distinct `id`s for pools sharing the core address; PancakeSwapV2 with
  `reservesUpdatedAt = null` **and** with a missing `this.pools[idx]` entry
  both fall back to RPC; Solidly returns distinct ids and reserves for the
  stable and volatile pools of the same token pair; LitePsm returns the four
  `gem ↔ dai/usds` keys and no `dai_usds` key; Aave GSM at `exposureCap`
  returns `underlying_gho: '0'` and a frozen GSM is omitted; EkuboV3
  publishes a pool inserted through `setPool` after initialization.
- Mode-B **direction** invariant (independent of capacity): the set of
  directed pairs implied by `reserves` (plain keys → every ordered pair of
  listed tokens; directional keys → exactly those keys) equals an **explicit
  expected set written per adapter in its test**, derived from that adapter's
  `getPricesVolume` guards. `getPoolIdentifiers` is not used as the oracle:
  StataV2 (`aave-v3-stata-v2.ts:150`) and ERC4626 return identifiers
  unconditionally, including for swaps pricing rejects. Each test carries at
  least one negative case (a pair the adapter must not list: Stata
  `underlying ↔ aToken`, LitePsm `dai ↔ usds`, Usual reverse, UsualPP
  `USD0 → USD0++`) and, where the state can disable a direction (ERC4626
  redeem/deposit flags, GSM frozen), one case asserting the key disappears
  rather than reading `'0'`. Values are not part of this check.
- Mode-B **capacity** cases, separate from direction: GSM at `exposureCap`
  keeps the `underlying_gho` key with value `'0'`; ERC4626 with redeem enabled
  and `totalAssets = 0` keeps `vault_asset: '0'`.
- Mode-B **value** check: each adapter's table row in §7 is the spec;
  `UNLIMITED_RESERVES` appears only where that row says so. No inference from
  `hasConstantPriceLargeAmounts` (false on UsualPP, AaveGsm, AngleTransmuter
  even though some of their directions are unlimited).
- Manual check on a slave: `getPoolsStorages()` lists expected dexes with the
  right mode; `HSCAN` returns descriptors; a 1000-item batch returns results
  for most descriptors and never throws; mode-B calls return within one
  multicall round-trip.

## 11. Delivery order

PR 1 (core) → PR 4 (mode B: LitePsm alone is 49 % of volume, and ~30 adapters
of a few lines each) → PR 2 (UniswapV2/Solidly) → PR 3 (EkuboV3, MaverickV2,
Algebra families).

## 12. Review round 1 — responses

| Finding                                        | Verdict                | Resolution                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `getStaleState()` bypasses validity         | Confirmed              | Skip pools with `isInvalid()`; stale-but-valid returned as-is (D9).                                                                                                                                                                   |
| 2. `getManyPoolReserves` loses the whole batch | Confirmed              | `multicallBalances` on `tryAggregate(false)`, per-pool decode, chunked (D8).                                                                                                                                                          |
| 3. Address does not identify Ekubo pools       | Confirmed              | `id` added to `PoolReserves` (D10); `reserves` keys are token addresses, unaffected.                                                                                                                                                  |
| 4. Aave GSM units                              | Confirmed              | Underlying side reports `underlyingLiquidity`; GHO side is `UNLIMITED_RESERVES` (mint capacity, D15), never a synthetic converted balance.                                                                                            |
| 5. Balancer V3 live balances not invertible    | Confirmed              | Balancer V3 removed; consumer uses Balancer API (verified).                                                                                                                                                                           |
| 6. Hit/miss quantity mismatch                  | Confirmed, accepted    | D13; UniV2 miss → `getReserves()`; Maverick V1 dropped by volume.                                                                                                                                                                     |
| 7. Startup-only publication                    | Confirmed              | Storages written on runtime refreshes too (D11); completeness column added.                                                                                                                                                           |
| 8. Writer/pruner races                         | Confirmed, accepted    | D12.                                                                                                                                                                                                                                  |
| PancakeSwapV2 cached pools have no reserves    | Confirmed (plan error) | §3 corrected; hit requires `reservesUpdatedAt !== null`.                                                                                                                                                                              |
| Version needs request-side rule                | Superseded             | Request-level versioning was added, then removed after PR 1 review (§16): the hash mixes descriptor shapes per entry during a rollout, so a per-request version cannot select a parser. New key per incompatible change instead (D3). |
| Expand verification                            | Accepted               | §10.                                                                                                                                                                                                                                  |

## 13. Review round 2 — responses

| Finding                              | Verdict   | Resolution                                                                                                                                                                                                                      |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Mode-B mapping reverses direction | Confirmed | D15 rewritten as `reserves[out]` = payout capacity for `in → out`; tracker flags populate the connector's entry. Verification switched to a `getPoolIdentifiers(in, out)` invariant. UsualPP row added with USD0++ → USD0 only. |
| 2. Aave GSM GHO "unlimited"          | Confirmed | `gho = toGho(max(exposureCap - underlyingLiquidity, 0))` via the pricing rate math; `'0'` at cap; frozen/seized GSMs omitted.                                                                                                   |
| 3. LitePsm omits USDS                | Confirmed | One pool per gem with `{ gem, dai, usds }`; `usds` shares `daiBalance` because `usdsPsm` wraps the DAI PSM.                                                                                                                     |
| 4. Solidly ids need `stable`         | Confirmed | Solidly overrides id derivation with `getPoolIdentifier(token0, token1, descriptor.stable)`; test covers both pools of one pair.                                                                                                |
| 5. PancakeSwapV2 hit predicate       | Confirmed | `p && p.reservesUpdatedAt != null`; missing-entry test added.                                                                                                                                                                   |
| 6. EkuboV3 runtime discovery         | Confirmed | Storage written from `setPool()`, the common insertion point for the initial load and `PoolInitialized` events.                                                                                                                 |

## 14. Review round 3 — responses

| Finding                                                  | Verdict                                                                                                        | Resolution                                                                                                                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Direction invariant conflated support with capacity   | Confirmed (GSM keeps returning identifiers at zero GHO capacity; LitePsm has DAI reserves but no `usds → dai`) | Introduced directional keys (D17). The invariant now compares the **set of directed pairs** implied by the keys with `getPoolIdentifiers(in, out, SELL)`, ignoring values. LitePsm and GSM rows rewritten with directional keys. |
| 2. `hasConstantPriceLargeAmounts` is not a capacity flag | Confirmed (false on UsualPP, AaveGsm, AngleTransmuter)                                                         | Clause removed; `UNLIMITED_RESERVES` is validated only against each adapter's row in §7.                                                                                                                                         |
| 3. Decoder exceptions escape `tryAggregate`              | Confirmed (`multi-wrapper.ts:112` calls `decodeFunction` unguarded)                                            | `multicallBalances` wraps every decode individually; unit test with a malformed successful return added.                                                                                                                         |

## 15. Review round 4 — responses

| Finding                                                 | Verdict                                                                                        | Resolution                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Stata needs directional keys                         | Confirmed (`getPricesVolume` requires one side to be stata; `underlying ↔ aToken` unsupported) | Four directional keys per stata token; negative case in test.                                                                                   |
| 2. `getPoolIdentifiers` is not a valid direction oracle | Confirmed (StataV2 and ERC4626 return ids unconditionally)                                     | Expected direction sets are written explicitly per adapter from `getPricesVolume` guards; disabled-direction and zero-capacity cases separated. |
| 3. D15 / PR4 intro contradicted D17                     | Confirmed                                                                                      | Both passages rewritten: values exist only for supported swaps; `'0'` = supported with zero capacity; unsupported = absent key.                 |

## 16. PR 1 review — responses

| Finding                                                                                            | Verdict                     | Resolution                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. One failed RPC chunk discards the whole batch (`tryAggregate` uses `Promise.all` across chunks) | Confirmed                   | `multicallBalances` chunks locally and isolates each chunk; failed chunk → `null` per call.                                                                   |
| 2. Request-level `version` rejected valid batches during rollouts                                  | Confirmed, then generalised | Versioning removed entirely (D3): the hash mixes descriptor shapes per entry, so a per-request version cannot help; incompatible changes get a new Redis key. |
| 3. Throwing `getPoolsStorage()` escaped the error boundary                                         | Confirmed                   | Per-dex try/catch in `getPoolsStorages()`; `PricingHelper.getPoolReserves` resolves inside its try and rethrows only `PoolReservesRequestError`.              |
| 4. Test helper regex coerced numeric values                                                        | Confirmed                   | `typeof value === 'string'` asserted.                                                                                                                         |
| 5. Invalid `chunkSize` silently returned `[]`                                                      | Confirmed                   | Positive-integer guard in `multicallBalances`.                                                                                                                |
| 6. Prune count log is analytics-style                                                              | Confirmed                   | Removed.                                                                                                                                                      |
| 7. `hscan` on `ICache` is a breaking interface change                                              | Accepted                    | Backend Redis cache must implement it before adopting this version.                                                                                           |

## 17. PR 4 — implementation notes

- Config-only adapters (Weth, wstETH, Spark, SparkPsm, UsdcTransmuter,
  PolygonMigrator, Swell, SkyConverter, AaveV3Pendle, StkGHO, the seven Usual
  keys, UsualPP, FxProtocolRusd, dETH/dBNB/dPOL) are covered by
  `src/dex/pool-reserves-mode-b.test.ts`, which runs without RPC and holds the
  explicit expected direction set and a negative case per adapter.
- State-backed adapters (LitePsm, ERC4626, AaveGsm, OSwap, WooFiV2,
  MiroMigrator, AngleTransmuter, AngleStakedStable, Cap, AaveV3, AaveV3Stata,
  AaveV3StataV2) are covered by
  `src/dex/pool-reserves-mode-b-integration.test.ts` (CI only, hits RPC).
- A state-backed adapter returns `[]` for a pool whose event state is missing
  or `isInvalid()`; only OSwap generates missing state itself because it has
  no `initializePricing`, one pool at a time so a failing pool does not hide
  the others. Paused (AngleStakedStable), frozen / seized (AaveGsm) pools and
  WooFiV2 base tokens with an infeasible oracle are omitted.
- `src/dex/pool-reserves-mode-b-fixtures.test.ts` holds RPC-free fixtures for
  the state cases that live chains cannot exercise on demand: WooFiV2
  infeasible token, AngleStakedStable paused, AngleTransmuter invalid state and
  failed balance call, OSwap partial generation failure, ERC4626 cooldown and
  empty vault, AaveGsm at cap / frozen / seized.
- `unlimitedReserves(tokens)` was added to `src/lib/pools-storage/reserves.ts`
  for the plain-key wrappers.

## 18. PR 4 review — responses

| Finding                                                      | Verdict          | Resolution                                                                                        |
| ------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| 1. WooFiV2 listed base tokens whose oracle is infeasible     | Confirmed        | Only the quote token and feasible base tokens are listed; pool omitted below two tokens.          |
| 2. AngleStakedStable published paused vaults                 | Confirmed        | `state.paused` omits the pool.                                                                    |
| 3. AngleTransmuter ignored missing / invalid event state     | Confirmed        | Fiats without valid state are skipped before the balance multicall.                               |
| 4. OSwap lost healthy pools when one pool failed to generate | Confirmed        | Only missing pools are generated, each in its own try/catch.                                      |
| 5. WooFiV2 poller may fetch over RPC when cold               | Rejected         | Matches D6 (RPC when no in-memory state); the poller is warm on slaves.                           |
| 6. `sDAI` ERC4626 test case used the wrong network           | Confirmed        | Case moved to Gnosis.                                                                             |
| 7. Deterministic fixtures for state cases                    | Accepted in part | Fixture test added for the cases above; slave-mode helper and exact token-list fixtures left out. |
