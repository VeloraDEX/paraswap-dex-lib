# Go Build Transaction Boundary: Implementation Details

## Current Status

Last updated: 2026-05-13

This file tracks implementation notes and task status for the TypeScript
resolved-build boundary described in:

- `docs/plans/go-build-transaction-boundary/go-build-transaction-boundary-plan.md`
- `docs/plans/go-build-transaction-boundary/implementation.md`

## Review Notes

- `GenericSwapTransactionBuilder.build()` is still the public API and already
  owns input defaults, direct/generic routing, `onlyParams`, transaction
  `value`, and gas fields.
- Phase 2 changed the generic `_build()` path into orchestration only:
  executor selection, `RoutePlan` conversion, resolved-leg construction,
  `BuildInput` construction, and dependency passing to
  `buildTransactionFromResolved()`.
- `buildTransactionFromResolved()` now owns generic executor bytecode encoding,
  generic Augustus V6 params, `partnerAndFee`, permit passthrough, transaction
  `value`, and gas fields for the four generic V6 executor methods.
- `buildResolvedCalls()` owns DEX param resolution, function-typed
  `needWrapNative` resolution, normalized per-leg amounts/tokens, WETH
  planning, and approval enrichment. It returns `ResolvedLeg[]` plus `wethPlan`
  and no longer builds executor bytecode directly.
- `_buildDirect()` delegates direct V6 param construction to DEX-specific
  `getDirectParamV6()` implementations. Direct swaps remain outside the
  resolved boundary after phase 2; the direct `TxObject` assembly in `build()`
  is intentionally duplicated until the direct boundary phase.
- Phase 1 implementation note: current `OptimalSwap` objects do not carry
  swap-level `srcAmount`/`destAmount` fields. `buildRoutePlan()` preserves any
  such fields if present and otherwise derives swap-level amounts by summing
  the nested `swapExchanges` amount strings. Per-exchange amount strings are
  copied unchanged.
- `Executor01BytecodeBuilder`, `Executor02BytecodeBuilder`, and
  `Executor03BytecodeBuilder` still consume `OptimalRate` plus a flat
  `DexExchangeBuildParam[]`. Phase 2 added an internal executor-compatible
  `OptimalRate` adapter in the resolved boundary. A later phase can replace the
  compatibility adapter with a route-plan-native bytecode path.
- Existing executor snapshot fixtures under `src/executor/fixtures/` already
  cover useful Executor01 and Executor02 route shapes and can be reused for
  generic parity tests. There is currently no `executor03` or WETH-only fixture
  folder under `src/executor/fixtures/`; phase 3 should add focused fixtures or
  test-local inputs for those paths.
- Jest only auto-runs tests under `tests/**` and `src/(dex|lib|executor)/**`.
  New resolved-boundary tests should go under `tests/generic-swap-transaction-builder/`.

## Phase 1 Scope

Phase 1 means checkpoint 1 from `implementation.md`: add types and conversion
helpers without changing `GenericSwapTransactionBuilder.build()` behavior.

The goal is to land a stable, serializable data contract and low-risk helpers
that later phases can call from the existing builder orchestration.

### In Scope

- Add a new resolved-build module:
  - `src/generic-swap-transaction-builder/resolved/types.ts`
  - `src/generic-swap-transaction-builder/resolved/route-plan.ts`
  - `src/generic-swap-transaction-builder/resolved/validation.ts`
  - `src/generic-swap-transaction-builder/resolved/index.ts`
- Define `BuildInput`, `DirectBuildInput`, `RoutePlan`, `ResolvedLeg`,
  `ResolvedDirectCall`, `FeeInput`, and `GasInput`.
- Add `buildRoutePlan(priceRoute: OptimalRate): RoutePlan`.
- Add `flattenRoutePlan(routePlan)` or equivalent traversal helper that yields
  stable `(routeIndex, swapIndex, swapExchangeIndex)` positions in nested route
  order.
- Add minimal invariant helpers for phase 1:
  - decimal amount string check
  - lowercase 42-character address check
  - `0x` hex bytes check
  - resolved-leg duplicate key detection
  - route-plan leg count check
- Add route-plan conversion tests using existing executor fixtures.
- Keep all public behavior unchanged.

### Out Of Scope

- Do not call `buildTransactionFromResolved()` from `build()` yet.
- Do not move DEX lookup, remote DEX params, approval checks, or WETH
  decisioning in this phase.
- Do not refactor executor builders away from `IDexHelper` yet.
- Do not implement the full generic resolved build yet.
- Do not implement the direct resolved build yet.
- Do not generate the full golden fixture suite yet.

## Phase 1 Design Details

### Type Definitions

Use existing repo types where possible:

- `Address`, `OptimalRate`, and `SwapSide` from existing exports/core types.
- `DexExchangeBuildParam`, `TxObject` from `src/types`.
- `DepositWithdrawReturn` from `src/dex/weth/types`.
- `Executors` from `src/executor/types`.
- `ContractMethodV6` from `@paraswap/core`.

`BuildInput` should include fields from the high-level plan, but phase 1 does
not need to construct it from the current builder yet. The type should still be
complete so later phases do not churn the contract.

`DirectBuildInput` should be intentionally simple:

- `contractMethod: ContractMethodV6`
- `params: unknown[]`
- `userAddress`
- `augustusV6Address`
- `srcToken`
- `srcAmount`
- `minMaxAmount`
- `side`
- optional gas fields

Direct DEX-specific tuple construction remains owned by DEX classes until the
direct boundary phase.

### RoutePlan Conversion

`buildRoutePlan(priceRoute)` should only copy serializable fields needed by the
executor route tree:

- route `percent`
- swap `srcToken`, `destToken`, `srcAmount`, `destAmount`
- swapExchange `exchange`, `percent`, `srcAmount`, `destAmount`

Normalize route tokens to lowercase while preserving amount strings exactly.
Do not include `swapExchange.data` in `RoutePlan`; DEX-specific data belongs in
`ResolvedLeg.exchangeParam` or direct-call input.

### Traversal Contract

Resolved legs are keyed by position, not by array order. The shared traversal
helper should be the only place that walks route positions:

```ts
type RoutePosition = {
  routeIndex: number;
  swapIndex: number;
  swapExchangeIndex: number;
};
```

Later phases should use this helper to build the resolved-leg lookup and to
reconstruct the executor-facing flat exchange param list.

### Compatibility Note

The current executor builders require `OptimalRate`. Later phases can initially
build a minimal executor-compatible `OptimalRate` from `BuildInput.routePlan`
for bytecode parity, while keeping that adapter internal to the resolved module.
That is a temporary compatibility layer, not the final Go-shaped contract.

## Phase 1 Tasks

| Status | Task                               | Notes                                                                                                                                                                                                             |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Review boundary plan docs          | Read both planning docs and captured implementation constraints here.                                                                                                                                             |
| Done   | Inspect current builder boundaries | Reviewed `build()`, `_build()`, `_buildDirect()`, `buildCalls()`, approval, WETH, and executor usage.                                                                                                             |
| Done   | Add resolved module folder         | Created `src/generic-swap-transaction-builder/resolved/`.                                                                                                                                                         |
| Done   | Add boundary types                 | Added serializable `BuildInput`, `DirectBuildInput`, `RoutePlan`, `ResolvedLeg`, `ResolvedDirectCall`, `FeeInput`, and `GasInput` in `types.ts`.                                                                  |
| Done   | Add route-plan conversion helper   | Added `buildRoutePlan(priceRoute)`, preserving nesting, normalizing swap tokens, excluding `swapExchange.data`, and copying per-exchange amounts unchanged.                                                       |
| Done   | Add traversal/key helpers          | Added nested-order `walkRoutePlan()`, `flattenRoutePlan()`, `routePositionKey()`, and `getRoutePlanLegCount()`.                                                                                                   |
| Done   | Add minimal validation helpers     | Added decimal amount, lowercase address, hex bytes, duplicate resolved-leg key, and route-plan leg count checks.                                                                                                  |
| Done   | Add unit tests                     | Added `tests/generic-swap-transaction-builder/resolved/route-plan.test.ts` covering Executor01 simple, Executor01 multiswap, Executor02 vertical branch, Executor02 multiswap, traversal, and validation helpers. |
| Done   | Run checks                         | `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`, `yarn check:tsc`, and `yarn check:es` passed on 2026-05-13.                                                                              |

## Acceptance Criteria

- `RoutePlan` preserves `bestRoute -> swaps -> swapExchanges` nesting.
- Route position keys are deterministic and do not depend on flat leg order.
- All phase 1 helpers are exported from the resolved module index.
- Existing runtime transaction building is untouched.
- New tests prove conversion for at least:
  - Executor01 simple swap fixture
  - Executor01 multiswap fixture
  - Executor02 vertical branch fixture
  - Executor02 multiswap or mega-swap fixture
- TypeScript compilation passes.

## Phase 2 Scope

Phase 2 means checkpoint 2 from `implementation.md`: add the generic resolved
boundary behind the existing builder flow and prove parity for one simple
fixture.

The goal is to introduce the transaction-assembly boundary without broadening
route coverage yet. The existing public `GenericSwapTransactionBuilder.build()`
API should remain the entrypoint, direct swaps should keep using `_buildDirect()`,
and all DEX lookup, remote DEX params, WETH planning, and approval checking
should still happen before the resolved boundary is called.

### In Scope

- Add the generic resolved-build entrypoint for phase 2:
  - `src/generic-swap-transaction-builder/resolved/build-transaction.ts`
  - optional internal compatibility helpers under the same `resolved/` folder
- Move or share generic transaction assembly logic now owned by `_build()`:
  - generic Augustus V6 params
  - `partnerAndFee` packing
  - permit passthrough
  - transaction `value`
  - gas field passthrough
- Expose both assembled generic call params and `TxObject` from the resolved
  boundary so `onlyParams` can stay a wrapper-level behavior.
- Reconstruct executor-facing inputs from `BuildInput`:
  - `DexExchangeBuildParam[]` by walking `RoutePlan` with `walkRoutePlan()`
  - a temporary executor-compatible route object from `RoutePlan`
- Add a builder orchestration helper that constructs `BuildInput` after current
  per-leg resolution, WETH planning, and approval enrichment.
- Normalize all address fields before constructing `BuildInput`, because phase 1
  validators require lowercase addresses.
- Add one parity test for a simple generic Executor01 SELL route.
- Keep `onlyParams` behavior unchanged by returning the resolved boundary's
  assembled params through the existing wrapper path.

### Out Of Scope

- Do not port direct swaps to `DirectBuildInput` yet.
- Do not expand parity to Executor02, Executor03, WETH-only, or golden fixture
  coverage yet.
- Do not move DEX lookup, remote DEX params, approval checks, or WETH
  decisioning into the resolved boundary.
- Do not refactor executor builders away from `IDexHelper` yet.
- Do not generate Go contract fixtures yet.

## Phase 2 Design Details

### Boundary Shape

Phase 2 should add the resolved entrypoint, but it can still use a temporary
TypeScript-only dependency seam for the current executor builders:

```ts
type ResolvedBuildOutput = {
  params: (string | string[])[];
  txObject: TxObject;
};

buildTransactionFromResolved(input: BuildInput, deps: ResolvedBuildDeps): ResolvedBuildOutput
```

`ResolvedBuildDeps` should be kept small and internal to this migration phase.
It can include the selected `ExecutorBytecodeBuilder` and the Augustus V6
interface or encoder needed to preserve byte-for-byte calldata. A later phase
should remove these dependencies by introducing the pure encoding context
described in `implementation.md`.

The wrapper should use `output.params` for `onlyParams` and `output.txObject`
for the normal transaction path. Do not add an `onlyParams` option to the
boundary; keeping the boundary return shape complete makes parity tests compare
both surfaces from one build.

`input.executorAddress` and `deps.bytecodeBuilder.getAddress()` must match.
Phase 2 should assert this precondition at boundary entry so executor selection
remains owned by the orchestrator and the boundary does not silently redetect or
substitute an executor address.

The boundary must not call `DexAdapterService`, `getTxBuilderDexByKey()`, the
remote new-dex API, WETH DEX builders, or `augustusApprovals.hasApprovals()`.

### Orchestration Split

`buildCalls()` currently resolves legs and immediately builds executor bytecode.
For phase 2, split this into smaller helpers without changing the external
behavior:

- resolve route-positioned leg data and raw WETH amounts
- build `wethPlan`
- add approval data
- produce `ResolvedLeg[]`
- call `buildTransactionFromResolved()`

The orchestration helpers that still pair route data with flat
`exchangeParams[]` should switch to the shared route-position traversal during
this split. In particular, replace the manual `currentExchangeParamIndex`
pattern in `addDexExchangeApproveParams()` and
`hasAnyRouteWithEthAndDifferentNeedWrapNative()` with position-keyed lookup or a
single traversal helper. The orchestrator and boundary should use the same
leg-addressing convention.

Before constructing `BuildInput`, normalize all address fields that cross the
boundary to lowercase, including route tokens, normalized leg tokens,
recipients, `userAddress`, `beneficiary`, `augustusV6Address`,
`executorAddress`, `wrappedNativeTokenAddress`, fee partner/referrer addresses,
and any WETH plan callees. Preserve amount strings and bytes fields unchanged.

If keeping the legacy `_build()` bytecode path during parity testing is useful,
keep it private and delete or collapse it after the first parity fixture is
stable.

### Compatibility Adapter

The phase 1 `RoutePlan` intentionally does not contain DEX-specific `data`.
Phase 2 should reconstruct only the route fields that executor builders need:
route percent, swap tokens, and swap-exchange amounts/percent/exchange names.

Do not rely on broad `as unknown as OptimalRate` casts to hide missing fields.
If an executor builder genuinely needs a field not present in `BuildInput` or
`RoutePlan`, add that serializable field explicitly and document it here.

### Validation

Use the phase 1 validators at the boundary before encoding:

- address fields in `BuildInput` and `ResolvedLeg`
- amount fields in `BuildInput`, `RoutePlan`, and `ResolvedLeg`
- `permit` and `exchangeData` hex byte fields where present
- `wethPlan.deposit` and `wethPlan.withdraw`, when present:
  - `callee` is a lowercase address
  - `calldata` is `0x` hex bytes
  - `value` is a decimal amount string
- duplicate resolved-leg keys
- route-plan leg count
- every route position has exactly one matching `ResolvedLeg`
- every resolved-leg key exists in the route plan; implement this as route
  position key-set equality, not only count equality plus duplicate detection
- `ResolvedLeg.exchangeParam.needWrapNative` is boolean
- `input.executorAddress === deps.bytecodeBuilder.getAddress()`

Missing/duplicate leg errors should include the `routeIndex:swapIndex:swapExchangeIndex`
key from `routePositionKey()`.

### Contract Method Coverage

Phase 2 should implement generic assembly for all generic V6 methods that share
the executor path:

- `swapExactAmountIn`
- `swapExactAmountOut`
- `swapExactAmountInPro`
- `swapExactAmountOutPro`

The first parity fixture only needs to cover one simple `swapExactAmountIn`
Executor01 SELL route. The remaining generic methods should still have unit
coverage for method allowlisting and param assembly, or the implementation must
explicitly mark any deferred method as out of scope before code lands.

### Parity Test Contract

The phase 2 parity test should compare both public builder surfaces:

- normal transaction object:
  - `tx.data` byte-for-byte
  - `tx.value`
  - `tx.from`
  - `tx.to`
  - gas fields
- `onlyParams` return:
  - complete params array, byte-for-byte for encoded bytes

Use normalized address casing consistently in expected values so strict object
comparison checks the intended contract rather than incidental checksum casing.

## Phase 2 Tasks

| Status | Task                              | Notes                                                                                                                                                                               |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Add generic resolved build module | Added `build-transaction.ts` and exported the phase 2 entrypoint from `resolved/index.ts`. Boundary returns `{ params, txObject }`.                                                 |
| Done   | Add temporary build dependencies  | Added explicit phase-2 deps for the selected `ExecutorBytecodeBuilder` and Augustus V6 interface. Boundary asserts executor address consistency.                                    |
| Done   | Add resolved input construction   | `_build()` now builds `BuildInput` after DEX param resolution, WETH planning, and approval enrichment. Boundary address fields are normalized to lowercase first.                   |
| Done   | Align orchestration leg traversal | `buildResolvedCalls()`, approval enrichment, and WETH consistency checks use `walkRoutePlan()` / `routePositionKey()` instead of manual flat-index route walks.                     |
| Done   | Reconstruct exchange param order  | Boundary reconstructs `DexExchangeBuildParam[]` by walking `RoutePlan` and looking up resolved legs by route-position key; validation checks route/resolved keys.                   |
| Done   | Add compatibility route adapter   | Added an internal executor-compatible `OptimalRate` adapter from `RoutePlan` with only serialized fields needed by current executor builders.                                       |
| Done   | Move generic tx assembly          | Generic swap params, `partnerAndFee`, permit, tx value, and gas assembly moved into `buildTransactionFromResolved()` for all four generic V6 executor methods.                      |
| Done   | Preserve `onlyParams`             | Generic `build({ onlyParams: true })` returns the resolved boundary params; parity test compares the complete params array.                                                         |
| Done   | Add boundary validation           | Added validation for addresses, amounts, bytes, WETH plan shape, route/resolved-leg key-set equality, boolean `needWrapNative`, method allowlist, and executor address consistency. |
| Done   | Add simple parity test            | Added an Executor01 simple SELL public-builder parity test using precomputed fixture exchange params and mocked approval-present decisions.                                         |
| Done   | Add generic method unit coverage  | Added unit coverage for param assembly and allowlisting for `swapExactAmountIn`, `swapExactAmountOut`, `swapExactAmountInPro`, and `swapExactAmountOutPro`.                         |
| Done   | Run checks                        | `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`, `yarn check:tsc`, and `yarn check:es` passed on 2026-05-13.                                                |

## Phase 2 Acceptance Criteria

- `GenericSwapTransactionBuilder.build()` remains the public API.
- The generic simple Executor01 SELL route produces the same params, calldata,
  transaction `value`, and gas fields through the resolved boundary.
- The resolved boundary returns both assembled params and transaction object;
  `onlyParams` uses the resolved params without re-assembling.
- Direct V6 methods still use the existing `_buildDirect()` path.
- No DEX lookup, remote HTTP, WETH decisioning, or approval checking occurs
  inside `buildTransactionFromResolved()`.
- Resolved legs are matched by route-position key, not array order.
- Boundary validation rejects missing, duplicate, or out-of-route resolved-leg
  keys; malformed WETH plans; non-boolean `needWrapNative`; unsupported generic
  contract methods; and executor address mismatches.
- Existing Phase 1 route-plan tests still pass.
- TypeScript compilation and source lint pass.

## Phase 3 Scope

Phase 3 means checkpoint 3 from `implementation.md`: expand generic resolved
boundary parity to Executor01, Executor02, Executor03, and WETH routes.

The goal is to prove the phase 2 boundary holds across the executor families and
route shapes that the future Go boundary must preserve. The existing public
`GenericSwapTransactionBuilder.build()` API remains the entrypoint. Direct V6
methods still use `_buildDirect()`. DEX lookup, remote DEX params, WETH
decisioning, and approval checks still happen before the resolved boundary.

### In Scope

- Broaden generic parity coverage beyond the phase 2 Executor01 simple SELL
  fixture.
- Cover representative generic executor paths:
  - Executor01 simple and multiswap SELL
  - Executor02 vertical branch SELL
  - Executor02 multiswap and/or mega swap SELL
  - Executor03 BUY
  - WETH-only ETH -> WETH route
- Cover approval-present and approval-missing behavior with deterministic
  approval decisions, not chain state.
- Cover WETH deposit and withdraw plans with precomputed WETH calldata.
- Add reusable test helpers for building public-builder parity inputs from
  route/exchange-param fixtures.
- Keep comparing both public builder surfaces:
  - full `TxObject`
  - `onlyParams` array
- Keep the phase 2 resolved boundary return shape and explicit temporary deps.

### Out Of Scope

- Do not port direct swaps to `DirectBuildInput` yet.
- Do not implement `buildDirectTransactionFromResolved()` yet.
- Do not remove the phase 2 `ResolvedBuildDeps` dependency seam yet.
- Do not replace executor builders with a pure encoding context yet.
- Do not refactor executor builders away from `IDexHelper` yet.
- Do not fix pre-existing executor snapshot test TypeScript failures unless
  phase 3 explicitly chooses to rely on those snapshot suites.
- Do not generate the complete Go contract fixture suite yet.
- Do not add a Go module.

## Phase 3 Design Details

### Current Baseline

Phase 2 already routes all non-direct generic V6 builds through
`buildTransactionFromResolved()`. The boundary validates serialized input,
reconstructs flat exchange params by `RoutePlan` position, builds a temporary
executor-compatible `OptimalRate`, and returns `{ params, txObject }`.

Phase 2 test coverage is intentionally narrow:

- one Executor01 simple SELL public-builder parity test
- method allowlisting and param assembly for the four generic V6 executor
  methods
- boundary validation error tests

Phase 3 should not rewrite this architecture. It should primarily harden it by
adding route-shape coverage and fixing any parity gaps those tests expose.

Current local baseline notes:

- `yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand`
  currently fails before running tests because the snapshot suites cast fixture
  exchange params to `DexExchangeParam[]`, while `buildByteCode()` now expects
  `DexExchangeBuildParam[]` with boolean `needWrapNative`. Phase 3 should either
  fix those snapshot test casts as a separate pre-task or avoid treating the
  snapshot command as a blocking phase-3 check.
- Existing Executor02 JSON fixtures under `src/executor/fixtures/executor02/`
  all have `bestRoute.length === 1`. Phase 3 should explicitly choose
  multiswap-only coverage for Executor02 or add a focused mega-swap fixture.
- Direct-path `TxObject` assembly remains duplicated in `build()` until the
  direct-boundary phase. Phase 3 should not clean it up except for comments or
  documentation.

### Parity Matrix

Use existing fixture files where possible. Proposed minimum matrix:

| Executor   | Scenario                            | Candidate fixture(s)                                                                                                                  | Notes                                                                                                                                     |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Executor01 | simple SELL, approval present       | `src/executor/fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json`                                                 | Already covered in phase 2; keep as the baseline.                                                                                         |
| Executor01 | simple ETH/WETH deposit or withdraw | `price-route-simpleSwap-univ3-eth-usdc.json`, `price-route-simpleSwap-univ3-usdc-eth.json` plus matching `maybe-weth-calldata/` files | Proves WETH plan passthrough and transaction `value`.                                                                                     |
| Executor01 | multiswap SELL                      | `price-route-multiswap-sushiv3-usdc-eth-wbtc.json` or `price-route-multiswap-sushiv3-usdt-usdc-dai.json`                              | Proves nested route traversal and flat exchange-param reconstruction.                                                                     |
| Executor01 | approval missing                    | Any non-ETH Executor01 route with `hasApprovals()` mocked false                                                                       | Expected boundary input must include `approveData`; compare calldata and `onlyParams`.                                                    |
| Executor02 | vertical branch SELL                | `src/executor/fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json`                                     | Proves same-swap parallel branches.                                                                                                       |
| Executor02 | multiswap SELL                      | `price-route-multiswap-univ3-usdt-dai-eth.json` or `price-route-multiswap-curvev1-univ3-dai-usdc-eth.json`                            | Proves multi-step branch traversal and WETH withdraw paths.                                                                               |
| Executor02 | mega swap SELL                      | Add a focused fixture only if phase 3 chooses mega coverage                                                                           | Existing Executor02 fixtures are single-route; otherwise explicitly defer mega to a later phase.                                          |
| Executor03 | BUY                                 | Add focused test-local BUY route data in the resolved-boundary tests                                                                  | No Executor03 JSON fixtures exist today; defer `src/executor/fixtures/executor03/` until there is an executor snapshot suite to share it. |
| WETH       | single ETH -> WETH route            | Add a focused test-local WETH-only route with one `Weth` swap exchange                                                                | `WETHBytecodeBuilder.buildByteCode()` returns `0x`; assert `output.params[4] === '0x'`, executor address, and transaction value.          |

If a listed fixture is stale or does not pass current executor snapshot
behavior, prefer creating a smaller focused fixture over weakening the parity
assertions.

### Test Helper Shape

Add a reusable helper in
`tests/generic-swap-transaction-builder/resolved/build-transaction.test.ts` or
a sibling test utility. It should accept:

- `priceRoute`
- flat `exchangeParams`
- optional `maybeWethCallData`
- `contractMethod`
- `minMaxAmount`
- `quotedAmount`
- approval decision function, e.g. `(pairs) => boolean[]`
- optional gas fields

The helper should:

- mock `DexAdapterService.isDirectFunctionNameV6()` as false
- mock `getTxBuilderDexByKey()` by exchange name and return fixture
  `exchangeParams` in route-position order
- mock WETH `getDepositWithdrawParam()` to return the precomputed
  `maybe-weth-calldata/*.json` payload when a route requires `wethPlan`
- mock `augustusApprovals.hasApprovals()` from the provided approval decision
  function with `mockImplementation((_spender, pairs) => decisionFn(pairs))`
- build the expected `BuildInput` with lowercase boundary addresses
- compare public `builder.build()` output to
  `buildTransactionFromResolved(input, deps)` for both normal tx and
  `onlyParams`
- provide a `buildTestPriceRoute(partial): OptimalRate` helper for hand-rolled
  Executor03 and WETH-only routes; it should fill required placeholders such as
  `srcDecimals`, `destDecimals`, `srcUSD`, `destUSD`, `gasCost`, `gasCostUSD`,
  `hmac`, `tokenTransferProxy`, `partnerFee`, and `version`

Do not rely on RPC, live approvals, or the remote new-dex API in phase 3 tests.

### Approval Coverage

Phase 2 only covers approval-present behavior. Phase 3 should add at least one
approval-missing parity case where `hasApprovals()` returns false for the
approval pair(s). The expected `ResolvedLeg.exchangeParam.approveData` must be
present, and the final executor bytecode must be compared byte-for-byte through
the outer Augustus calldata.

For multi-leg routes, avoid fixed-length approval mocks. Return one boolean per
requested approval pair so later fixture expansion does not silently mismatch
the approval count.

### WETH Coverage

Phase 3 should cover both ordinary executor WETH plans and the WETH-only
executor:

- ordinary WETH plan: Executor01 or Executor02 route with existing
  `maybe-weth-calldata` fixture; compare deposit/withdraw calldata passthrough
  and transaction value
- WETH-only route: route detected as `Executors.WETH` by `isSingleWrapRoute()`;
  set `priceRoute.network` to a supported WETH executor network (`MAINNET`,
  `AVALANCHE`, `BSC`, `BASE`, `POLYGON`, `OPTIMISM`, `GNOSIS`, `UNICHAIN`, or
  `SONIC`), verify `executorAddress` is the wrapped native token address,
  assert the executor-data params entry (`output.params[4]`) is `0x`, and verify
  transaction value equals the sell source amount

If WETH-only orchestration exposes that `buildResolvedCalls()` still expects a
DEX param for the `Weth` leg, keep the fix narrowly scoped to preserving current
public build behavior and document the resulting resolved input shape here.

### Executor03 Notes

Executor03 can reorder exchange params internally by `needWrapNative`. Phase 3
tests should compare final public outputs, not intermediate flat array order.
Resolved legs must still be keyed by route position, and the boundary must still
reconstruct the executor input by walking `RoutePlan`.

Because there are no current `src/executor/fixtures/executor03/` JSON fixtures,
phase 3 should keep the BUY route data test-local to the resolved-boundary
tests. Defer a shared `src/executor/fixtures/executor03/` directory until an
Executor03 snapshot suite exists and can reuse it.

### Compatibility Adapter Watchpoints

The phase 2 compatibility adapter sets only serialized fields needed by current
executor builders. During phase 3, if Executor02, Executor03, or WETH requires
a field missing from `BuildInput`/`RoutePlan`, add that serializable field
explicitly to the boundary type and update phase 1 route-plan tests. Do not hide
missing fields with broad `as unknown as OptimalRate` casts.

## Phase 3 Tasks

| Status | Task                                  | Notes                                                                                                                                                                                        |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Review phase 2 baseline               | Confirmed phase 2 boundary, helper names, validation, and the Executor01 simple public-builder parity test before broadening fixtures.                                                       |
| Done   | Decide executor snapshot baseline     | Kept executor snapshot suites out of phase-3 blocking checks because they still fail to compile on fixture casts to `DexExchangeParam[]`.                                                    |
| Done   | Add reusable parity helper            | Added a table-capable helper that builds expected `BuildInput`, mocks DEX params/WETH/approvals, provides `buildTestPriceRoute(partial)`, and compares both `TxObject` and `onlyParams`.     |
| Done   | Add Executor01 simple WETH cases      | Covered ETH -> USDC deposit and USDC -> ETH withdraw routes using existing Executor01 WETH calldata fixtures.                                                                                |
| Done   | Add Executor01 multiswap parity       | Covered `price-route-multiswap-sushiv3-usdc-eth-wbtc.json` and verified multi-swap route-position traversal through parity.                                                                  |
| Done   | Add approval-missing parity           | Mocked `hasApprovals()` false for the Executor01 USDC -> USDT route and asserted resolved `approveData` is injected while final calldata stays in parity.                                    |
| Done   | Add Executor02 vertical branch parity | Covered `price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json` with three same-swap branches.                                                                                             |
| Done   | Add Executor02 multiswap parity       | Covered `price-route-multiswap-univ3-usdt-dai-eth.json` with existing WETH calldata.                                                                                                         |
| Done   | Decide Executor02 mega coverage       | Deferred mega coverage; current Executor02 fixtures all have `bestRoute.length === 1`, so adding mega would require a new authored fixture.                                                  |
| Done   | Add Executor03 BUY parity             | Added a focused test-local BUY route derived from the simple USDC -> USDT fixture and forced through Executor03 with `swapExactAmountOut`.                                                   |
| Done   | Add WETH-only parity                  | Added a supported MAINNET ETH -> WETH route detected as `Executors.WETH`; verified wrapped-native executor address, `output.params[4] === '0x'`, tx value, and params parity.                |
| Done   | Update docs with fixture outcomes     | Fixture choices, WETH-only behavior, no-new-field outcome, and deferred mega coverage are recorded below.                                                                                    |
| Done   | Run checks                            | `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`, `yarn check:tsc`, and `yarn check:es` pass. Snapshot suites remain non-blocking due the pre-existing cast baseline. |

### Phase 3 Completion Notes

- Added a reusable resolved-boundary parity helper in
  `tests/generic-swap-transaction-builder/resolved/build-transaction.test.ts`.
  It builds explicit `BuildInput` values, mocks DEX params, mocks WETH
  deposit/withdraw payloads, derives approval decisions from the observed
  approval pairs, and compares both full `TxObject` output and `onlyParams`.
- Executor01 parity now covers:
  - simple USDC -> USDT SELL with approvals present
  - ETH -> USDC WETH deposit
  - USDC -> ETH WETH withdraw
  - multiswap `price-route-multiswap-sushiv3-usdc-eth-wbtc.json`
  - approval-missing USDC -> USDT with injected `approveData`
- Executor02 parity now covers:
  - vertical branch `price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json`
  - multiswap `price-route-multiswap-univ3-usdt-dai-eth.json`
- Executor03 BUY parity uses a focused test-local route derived from the simple
  USDC -> USDT fixture and forced through `swapExactAmountOut`.
- WETH-only parity uses a focused MAINNET ETH -> WETH route with a `Weth` leg;
  it verifies `Executors.WETH`, wrapped-native executor address,
  `output.params[4] === '0x'`, transaction `value`, and `onlyParams` parity.
- No new serializable `BuildInput` or `RoutePlan` fields were needed.
- Executor02 mega coverage is intentionally deferred because the existing
  Executor02 fixture set has only single-route price routes. Adding mega
  coverage requires authoring a new `bestRoute.length > 1` fixture, and should
  be carried into a later parity/backlog phase when that fixture exists.

## Phase 3 Acceptance Criteria

- Generic `GenericSwapTransactionBuilder.build()` still routes through
  `buildTransactionFromResolved()` for non-direct V6 methods.
- Direct V6 methods still use `_buildDirect()`.
- Public builder parity is proven for Executor01, Executor02, Executor03, and
  WETH-only routes.
- At least one approval-present and one approval-missing route are covered.
- At least one WETH deposit/withdraw plan is covered.
- WETH-only route produces `0x` executor data and correct transaction `value`.
- `onlyParams` parity is checked for every phase 3 route fixture.
- No DEX lookup, remote HTTP, WETH decisioning, or approval checking is added
  inside `buildTransactionFromResolved()`.
- Any new fields required by executor compatibility are added explicitly to
  `BuildInput`/`RoutePlan` and documented here.
- If phase 3 adds or changes shared `src/executor/fixtures/`, relevant executor
  snapshot tests must compile and pass; otherwise shared fixture changes should
  be deferred.
- Existing phase 1 route-plan and phase 2 simple parity tests still pass.
- TypeScript compilation and source lint pass.

## Suggested Test Commands

Phase 1:

```bash
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
```

Phase 2:

```bash
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Phase 3:

```bash
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Optional phase 3 snapshot check after fixing the pre-existing snapshot fixture
cast baseline:

```bash
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
```
