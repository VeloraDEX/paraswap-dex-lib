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
  `getDirectParamV6()` implementations and now returns only the resolved direct
  call `{ contractMethod, params }`. Phase 4 keeps DEX-specific direct params
  outside the boundary while `buildDirectTransactionFromResolved()` owns direct
  wrapper validation, calldata encoding, native `value`, and gas fields.
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
  generic parity tests. There is currently no shared `executor03` or WETH-only
  fixture folder under `src/executor/fixtures/`; phase 3 covered those paths
  with focused test-local route data.
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

## Phase 4 Scope

Phase 4 means checkpoint 4 from `implementation.md`: add direct boundary parity.

The goal is to remove the remaining direct-path `TxObject` assembly duplication
from `GenericSwapTransactionBuilder.build()` without moving DEX-specific direct
parameter construction into the resolved boundary. DEX implementations still own
`getDirectParamV6()`. The resolved direct boundary should receive the already
resolved direct method and params, validate the serializable wrapper fields,
encode Augustus V6 calldata, compute transaction `value`, and return the same
public builder output.

### In Scope

- Add a direct resolved-build entrypoint, either in
  `src/generic-swap-transaction-builder/resolved/build-transaction.ts` or a
  sibling resolved module:
  - `buildDirectTransactionFromResolved(input, deps)`
  - `ResolvedDirectBuildOutput` or equivalent output type
- Reuse and, if needed, refine `DirectBuildInput` / `ResolvedDirectCall` from
  phase 1.
- Keep `getDirectParamV6()` outside the boundary. It should still produce the
  DEX-specific direct params.
- Move direct transaction object assembly out of `build()`:
  - `from`
  - `to`
  - `value`
  - calldata encoding
  - gas fields
- Preserve `onlyParams` behavior for direct methods by returning the direct
  boundary params, not reassembling them in the wrapper.
- Add direct parity tests that compare:
  - full direct `TxObject`
  - direct `onlyParams`
  - direct transaction `value` for native source tokens
  - gas field passthrough
  - byte-identical `tx.data` against the current DEX-provided encoder output
- Cover representative direct V6 method families:
  - UniswapV2 SELL and BUY
  - UniswapV3 SELL or BUY
  - BalancerV2 SELL or BUY
  - CurveV1 or CurveV2 SELL; Curve direct BUY is not available
  - LitePsm for `swapExactAmountInOutOnMakerPSM`
  - Augustus RFQ try-batch-fill
- Keep all generic phase 1-3 tests passing.

### Out Of Scope

- Do not move DEX-specific `getDirectParamV6()` logic into the boundary.
- Do not force direct swaps into `RoutePlan` or `ResolvedLeg[]`.
- Do not generate golden JSON fixtures yet.
- Do not replace generic executor builders with a pure encoding context yet.
- Do not change public `GenericSwapTransactionBuilder.build()` arguments or
  return shape.
- Do not broaden direct coverage to every DEX/fork if representative method
  families prove the boundary contract.

## Phase 4 Design Details

### Current Baseline

After phase 3, all non-direct generic V6 builds route through
`buildTransactionFromResolved()`. Direct V6 methods still branch in
`GenericSwapTransactionBuilder.build()`, call `_buildDirect()`, and then inline
direct `TxObject` assembly in the wrapper.

Current direct path shape:

- `build()` normalizes `_quotedAmount`, `_beneficiary`, default booleans, and
  `permit`.
- `_buildDirect()` validates the route is direct-compatible, finds the DEX from
  the single swap exchange, computes direct `srcAmount`/`destAmount`, packs
  `partnerAndFee`, and calls `dex.getDirectParamV6()`.
- `dex.getDirectParamV6()` returns `{ encoder, params, networkFee }`.
- `build()` returns `params` immediately for `onlyParams`.
- Otherwise `build()` computes `value` and calls `encoder.apply(null, params)`
  to produce `tx.data`.

Phase 4 should preserve the first two bullets and replace only the final wrapper
assembly with a resolved direct boundary.

### Direct Boundary Shape

Prefer a return shape parallel to the generic boundary:

```ts
type ResolvedDirectBuildOutput = ResolvedDirectCall & {
  txObject: TxObject;
};

type DirectResolvedBuildDeps = {
  augustusV6Interface: Interface;
};

buildDirectTransactionFromResolved(
  input: DirectBuildInput,
  deps: DirectResolvedBuildDeps,
): ResolvedDirectBuildOutput
```

`DirectBuildInput` already contains the important phase 1 fields:

- `contractMethod`
- `params`
- `userAddress`
- `augustusV6Address`
- `srcToken`
- `srcAmount`
- `minMaxAmount`
- `side`
- optional `gas`

Phase 4 should add or confirm any missing fields explicitly. Do not pass the DEX
`encoder` function across the boundary; that function is not serializable and is
not part of the Go contract. The direct boundary should encode with the Augustus
V6 ABI using `input.contractMethod` and `input.params`. Parity tests must prove
this matches the DEX-provided encoder output currently used by `build()`.

Unlike generic `BuildInput`, direct `DirectBuildInput` should not carry `fee`,
`uuid`, `permit`, `beneficiary`, or `blockNumber` as top-level boundary fields.
Those values are already baked into the DEX-returned direct params by
`getDirectParamV6()`.

Boundary address normalization applies to wrapper fields such as
`DirectBuildInput.srcToken`, which is used for transaction `value` calculation.
Do not normalize or assert lowercase casing inside opaque DEX-returned nested
params, such as a direct Uniswap tuple's embedded source token. ABI address
encoding is case-insensitive, and those params are DEX-owned payloads.

### Direct Orchestration Split

Keep `_buildDirect()` or replace it with a clearer helper such as
`buildResolvedDirectCall()`, but its responsibility should end at producing
DEX-specific direct call params.

Recommended flow:

1. `build()` computes the existing `_quotedAmount`, `_beneficiary`, boolean
   defaults, and `permit` default before entering the direct path.
2. `build()` detects `isDirectFunctionNameV6(priceRoute.contractMethod)`.
3. Direct orchestration calls `getDirectParamV6()` and receives the direct DEX
   result.
4. `_buildDirect()` or `buildResolvedDirectCall()` should return only
   `ResolvedDirectCall` data: `{ contractMethod, params }`. Drop the
   DEX-returned `encoder` and `networkFee` from the data flow once encoder
   parity is covered by tests.
5. `build()` constructs `DirectBuildInput` with normalized boundary addresses.
6. `buildDirectTransactionFromResolved()` validates and returns
   `{ params, txObject }`.
7. `build()` returns `output.params` for `onlyParams`, otherwise
   `output.txObject`.

This removes the direct branch's duplicated value/gas/calldata assembly while
leaving DEX lookup and direct param construction in TypeScript orchestration.

### Direct Method Coverage

The direct boundary should explicitly allow current V6 direct methods:

- `swapExactAmountInOnUniswapV2`
- `swapExactAmountOutOnUniswapV2`
- `swapExactAmountInOnUniswapV3`
- `swapExactAmountOutOnUniswapV3`
- `swapExactAmountInOnBalancerV2`
- `swapExactAmountOutOnBalancerV2`
- `swapExactAmountInOnCurveV1`
- `swapExactAmountInOnCurveV2`
- `swapOnAugustusRFQTryBatchFill`
- `swapExactAmountInOutOnMakerPSM`

Curve direct methods are SELL-only in V6; there is no
`swapExactAmountOutOnCurve*` method. Phase 4 BUY coverage must come from
UniswapV2, UniswapV3, or BalancerV2.

`swapExactAmountInOutOnMakerPSM` is implemented by
`src/dex/lite-psm/lite-psm.ts` (`LitePsm`), not by a `maker-psm` direct module.

Do not include the generic executor methods
`swapExactAmountIn`, `swapExactAmountOut`, `swapExactAmountInPro`, or
`swapExactAmountOutPro` in the direct allowlist.

Hardcode the 10-method direct V6 allowlist above. Avoid importing
`DirectContractMethods` from `@paraswap/core`; it also contains legacy V5
methods and generic Pro methods through the fee-model list, so it is too broad
for this boundary. The wrapper can still rely on
`isDirectFunctionNameV6(priceRoute.contractMethod)` before constructing
`DirectBuildInput`.

### Direct Validation

Add validation near the direct boundary, following the phase 2 validation style:

- `contractMethod` is in the direct V6 allowlist.
- `params` is an array; reject `null`, `undefined`, and non-array values at
  runtime.
- `userAddress`, `augustusV6Address`, and `srcToken` are lowercase addresses.
- `srcAmount` and `minMaxAmount` are decimal amount strings.
- optional gas fields are decimal amount strings.
- direct `permit` bytes do not need separate validation here because permit is
  already inside DEX-specific `params`; deep param validation is deferred to
  golden fixtures unless a helper can validate the common tuple safely.

Native value calculation should match the current wrapper exactly:

- if `srcToken` is ETH and side is SELL, value is `srcAmount`
- if `srcToken` is ETH and side is BUY, value is `minMaxAmount`
- otherwise value is `0`

### Direct Test Strategy

Place phase 4 direct tests in
`tests/generic-swap-transaction-builder/resolved/build-direct-transaction.test.ts`
so Jest picks them up through the existing resolved-boundary path and direct
tests stay isolated from the route-plan generic helper.

The phase 3 parity helper should not be stretched to direct routes if it makes
the fixture setup opaque. Direct routes are intentionally not route-plan based.
Prefer a focused helper that:

- builds a single-route/single-swap `OptimalRate`
- mocks `isDirectFunctionNameV6()` true for the selected method
- mocks `getTxBuilderDexByKey()` to return a direct DEX with
  `getDirectParamV6()`
- returns both the current DEX-provided encoder result and the resolved direct
  boundary result for comparison
- for each covered method, captures
  `dexResult.encoder(...dexResult.params)` and asserts it equals
  `boundary.txObject.data`
- checks `builder.build()` normal tx and `onlyParams`

For UniswapV2/UniswapV3/Balancer/Curve, a minimal deterministic mock DEX is
acceptable because phase 4 is testing the direct boundary contract, not
DEX-specific pool encoding. For LitePsm and RFQ, use representative params that
exercise nested tuple payloads so `unknown[]` direct params are not accidentally
narrowed to only string arrays. RFQ setup must inject preprocessed
`data.orderInfos` directly or call `GenericRFQ.preProcessTransaction()` before
`getDirectParamV6()`; `GenericRFQ.getDirectParamV6()` throws when
`orderInfos === null`.

### Phase 4 Watchpoints

- `TxInfo<DirectParam>.params` is generic and can contain nested tuples. Avoid
  typing direct params as `(string | string[])[]`; use `unknown[]`.
- Some direct DEX implementations return an `encoder` that already wraps
  `augustusV6Interface.encodeFunctionData(contractMethod, params)`. The new
  boundary should reproduce that with the Augustus V6 interface rather than
  carrying the encoder function forward.
- `_buildDirect()` has special route validation for
  `swapOnAugustusRFQTryBatchFill`, where the route may not have exactly one
  swap exchange. Keep that behavior outside the boundary.
- Direct value assembly currently uses the top-level `priceRoute.srcToken`,
  `priceRoute.srcAmount`, and `minMaxAmount`, not the DEX-returned params. The
  direct boundary should preserve that contract.
- Direct-path address normalization should match the generic boundary
  precondition: normalize before constructing `DirectBuildInput`, then validate
  at boundary entry.

## Phase 4 Tasks

| Status | Task                                  | Notes                                                                                                                                                                                                                            |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Review direct baseline                | Inspected `_buildDirect()`, the inline direct `build()` branch, `DirectBuildInput`, and representative direct encoders for UniswapV2, UniswapV3, BalancerV2, Curve, LitePsm, and RFQ.                                            |
| Done   | Add direct resolved output type       | Added `ResolvedDirectBuildOutput = ResolvedDirectCall & { txObject: TxObject }`, preserving `params: unknown[]`.                                                                                                                 |
| Done   | Add direct boundary entrypoint        | Added `buildDirectTransactionFromResolved(input, deps)` with the 10-method V6 direct allowlist, side/method consistency validation, wrapper validation, Augustus V6 ABI encoding, native value calculation, and gas passthrough. |
| Done   | Wire direct branch through boundary   | Direct public builds now keep `getDirectParamV6()` outside the boundary, build normalized `DirectBuildInput`, and return direct boundary params or tx output from `build()`.                                                     |
| Done   | Remove direct `TxObject` duplication  | Removed the inline direct `value`, `data`, and gas assembly plus the phase 2 TODO from `build()`.                                                                                                                                |
| Done   | Add direct helper tests               | Added focused tests in `tests/generic-swap-transaction-builder/resolved/build-direct-transaction.test.ts`, isolated from route-plan generic helpers.                                                                             |
| Done   | Assert DEX encoder byte parity        | Every covered direct method compares the mocked DEX encoder output to `buildDirectTransactionFromResolved(...).txObject.data`; paired-method mocks derive the encoded method from `side` like real DEX encoders.                 |
| Done   | Cover representative direct methods   | Covered UniswapV2 SELL and BUY, UniswapV3 SELL, BalancerV2 BUY, CurveV1 SELL, LitePsm, and Augustus RFQ try-batch-fill with nested tuple params for LitePsm/RFQ.                                                                 |
| Done   | Cover direct native value and gas     | Covered ETH-source SELL value from `srcAmount`, BUY native value from `minMaxAmount`, and gas field passthrough.                                                                                                                 |
| Done   | Cover direct validation errors        | Added direct boundary rejection coverage for unsupported direct method, side/method mismatch, invalid side, malformed lowercase address, malformed decimal amount/gas, `null` params, and non-array params.                      |
| Done   | Update docs with implementation notes | Recorded direct boundary implementation, mock coverage choices, `unknown[]` direct params, and no deferred representative method families below.                                                                                 |
| Done   | Run checks                            | `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`, `yarn check:tsc`, and `yarn check:es` passed on 2026-05-13.                                                                                             |

### Phase 4 Completion Notes

- Added `buildDirectTransactionFromResolved()` to the resolved build module. It
  validates the direct V6 method allowlist, rejects invalid sides and
  side/method mismatches for directional direct methods, checks serialized
  wrapper fields, encodes calldata with the Augustus V6 ABI, calculates direct
  native `value` from top-level `srcToken`/`srcAmount`/`minMaxAmount`, and
  passes gas fields through to `TxObject`.
- Added `ResolvedDirectBuildOutput` while keeping direct params typed as
  `unknown[]`, so nested tuple payloads from LitePsm and RFQ remain supported.
- `GenericSwapTransactionBuilder.build()` now routes direct V6 methods through
  the direct resolved boundary after `_buildDirect()` returns DEX-owned
  `{ contractMethod, params }`. The DEX-returned `encoder` and `networkFee` no
  longer flow into direct wrapper assembly.
- `getDirectParamV6()` remains outside the boundary and still owns all
  DEX-specific direct params. The boundary does not inspect or normalize opaque
  nested direct params.
- Direct parity tests use deterministic mock DEX direct results for:
  - UniswapV2 SELL and BUY
  - UniswapV3 SELL
  - BalancerV2 BUY
  - CurveV1 SELL
  - LitePsm `swapExactAmountInOutOnMakerPSM`
  - Augustus RFQ `swapOnAugustusRFQTryBatchFill`
- For each covered direct method, tests compare the DEX-provided encoder bytes
  to the new boundary calldata, then compare public `builder.build()` normal tx
  and `onlyParams` output to the boundary output. Paired direct-method test
  encoders derive the encoded method from `side`, matching the real UniswapV2,
  UniswapV3, and BalancerV2 direct encoder behavior.
- No representative direct method family from the phase 4 scope was deferred.
- Phase 5 added committed, RPC-free resolved-build golden fixtures under
  `tests/generic-swap-transaction-builder/fixtures/resolved-build/`. Fixture
  playback now asserts boundary output, public builder parity for all success
  fixtures, canonical JSON bytes, schema/coverage validation, and exact
  negative validation errors.

## Phase 4 Acceptance Criteria

- Direct V6 methods still call DEX-specific `getDirectParamV6()` outside the
  resolved boundary.
- Normal direct `builder.build()` output is assembled by
  `buildDirectTransactionFromResolved()`.
- Direct `onlyParams` returns the direct boundary params.
- The inline direct `TxObject` assembly in `build()` is removed.
- Direct boundary validation rejects unsupported direct methods and malformed
  serialized wrapper fields.
- Direct parity is proven for representative V6 direct method families,
  including at least one BUY method from UniswapV2, UniswapV3, or BalancerV2
  and one native-source SELL route.
- For every covered direct method, boundary calldata is byte-identical to the
  current DEX-provided encoder output.
- Nested direct params are supported as `unknown[]`.
- Runtime validation rejects `null` and non-array direct params.
- Generic phase 1-3 parity tests still pass.
- TypeScript compilation and source lint pass.

## Phase 5 Scope

Phase 5 means checkpoint 5 from `implementation.md`: generate complete golden
fixtures.

The goal is to turn the behavior proven by phases 1-4 into a stable, RPC-free
fixture contract that can be consumed by both TypeScript tests and the future Go
implementation. The fixtures should serialize the exact `BuildInput` or
`DirectBuildInput` passed to the resolved boundary and the expected boundary
output. They should not depend on live RPC, current approval state, remote DEX
APIs, or mutable runtime configuration.

### In Scope

- Add a committed fixture set under a test-owned path, recommended:
  - `tests/generic-swap-transaction-builder/fixtures/resolved-build/`
- Define a versioned JSON fixture shape for both generic and direct boundary
  inputs.
- Include the full boundary output in each fixture:
  - `expectedParams` for `onlyParams` parity
  - `expectedTx` for normal transaction parity
- Convert the existing phase 2-4 parity cases into persisted golden fixtures
  instead of keeping them only as in-memory test cases.
- Add JSON-driven fixture tests that load every golden fixture and assert:
  - `buildTransactionFromResolved(input, deps)` or
    `buildDirectTransactionFromResolved(input, deps)` matches the expected
    output
  - public `GenericSwapTransactionBuilder.build()` still matches the fixture
    for both normal tx and `onlyParams` for every success fixture that is not
    explicitly marked `boundaryOnly`
- Keep fixtures deterministic:
  - explicit approval decisions
  - explicit WETH deposit/withdraw calldata
  - explicit direct params
  - stable UUID, block number, addresses, gas fields, and quoted amounts
- Add negative golden fixtures for boundary validation errors with
  `expectedError` strings that the Go implementation must match.
- Add fee and edge-value fixtures that exercise partner-and-fee packing,
  non-empty permit bytes, native value behavior, and zero-valued quoted or
  amount fields where valid.
- Cover the remaining high-level fixture matrix gaps:
  - Executor02 mega swap
  - same-token-pair internal split
  - `permit2Approval`
  - `transferSrcTokenBeforeSwap`
  - `needUnwrapNative`
- Add direct golden fixtures for the full current V6 direct allowlist, not only
  the representative method families from phase 4.
- Keep all phase 1-4 tests passing while adding fixture-driven coverage.

### Out Of Scope

- Do not add the Go implementation yet.
- Do not replace the phase 2 `ResolvedBuildDeps` executor-builder dependency
  seam yet.
- Do not move DEX-specific `getDexParam()` or `getDirectParamV6()` logic into
  fixture playback.
- Do not rely on Tenderly, RPC, live approvals, or remote new-dex APIs to
  generate or validate committed fixtures.
- Do not broaden direct coverage to every fork of a method family unless the
  fork changes direct boundary input or calldata semantics.

## Phase 5 Design Details

### Fixture Contract And Shape

Use compact versioned shapes so fixtures can be migrated intentionally. The
cross-language fixture contract is:

- `schemaVersion`
- `name`
- `kind`
- `coverage`
- `input`
- either `expectedParams` plus `expectedTx`, or `expectedError`

The `orchestration` field is TypeScript-only test metadata. It exists only to
replay the public `GenericSwapTransactionBuilder.build()` path with
deterministic mocks. Go consumers must ignore `orchestration`; it is not part of
the Go build boundary contract.

```ts
type ResolvedBuildSuccessFixture = {
  schemaVersion: 1;
  name: string;
  kind: 'generic' | 'direct';
  description?: string;
  coverage: CoverageTag[];
  input: BuildInput | DirectBuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
  orchestration: {
    priceRouteFixture?: string;
    exchangeParamsFixture?: string;
    wethPlanFixture?: string;
    approvalDecisions?: boolean[];
    directDexKey?: string;
  };
  boundaryOnly?: false;
};

type ResolvedBuildBoundaryOnlySuccessFixture = Omit<
  ResolvedBuildSuccessFixture,
  'orchestration' | 'boundaryOnly'
> & {
  boundaryOnly: true;
  boundaryOnlyReason: string;
};

type ResolvedBuildNegativeFixture = {
  schemaVersion: 1;
  name: string;
  kind: 'negative';
  description?: string;
  coverage: CoverageTag[];
  input: BuildInput | DirectBuildInput;
  expectedError: string;
};
```

Success fixtures should include `orchestration` by default. Converted phase 2-4
fixtures must include it so Phase 5 preserves the public-builder parity
contract already proven by those phases. A success fixture may omit
`orchestration` only when it is explicitly marked `boundaryOnly: true` with a
`boundaryOnlyReason`; boundary-only fixtures are exceptions and must be reviewed
as such. Negative fixtures normally omit `orchestration` because they assert
boundary validation errors rather than successful public-builder replay.

`schemaVersion: 1` must be enforced by fixture loaders. Bumping the schema
version requires a migration script that rewrites all committed fixtures, and CI
must reject fixtures with unsupported or mixed schema versions.

Keep every numeric value that can exceed JavaScript safe integer range as a
string. Addresses in top-level boundary fields must be lowercase. Opaque
DEX-owned nested params should be serialized exactly as supplied to the
boundary, without lowercasing or deep validation.

`expectedParams` is intentionally part of the fixture contract. The public
builder preserves `onlyParams`, and the future Go implementation needs to match
both calldata-producing params and final `TxObject`.

`DirectBuildInput` intentionally has no top-level fee or permit fields. For
direct methods, fee, permit, UUID, beneficiary, and block-number metadata are
already baked into the DEX-owned direct `params` before the boundary is called.

`input.wethPlan`, when present, is the post-normalization boundary shape. In
particular, `deposit.callee` and `withdraw.callee` must be lowercase. Any raw
`maybe-weth-calldata/*.json` fixture path belongs only in
`orchestration.wethPlanFixture`.

`DexExchangeBuildParam` JSON conventions:

- Optional fields whose TypeScript value is `undefined` are omitted from JSON,
  not serialized as `null`.
- Safe small numeric fields remain JSON numbers:
  `returnAmountPos`, `insertFromAmountPos`, and `specialDexFlag`.
- Amounts, packed fee values, token amounts, gas fields, and any value that can
  exceed JavaScript safe integer range are decimal strings.
- `needWrapNative` must be a boolean in committed fixtures, never a function.

Native token fields must use the literal lowercase
`src/constants.ts:ETHER_ADDRESS` value. The generic and direct boundaries
compare native source tokens by exact string equality before calculating
transaction `value`.

### Coverage Tags

`coverage` is a controlled vocabulary, not free-form text. Fixture loaders
should reject unknown tags. Initial tags:

```ts
type CoverageTag =
  | 'generic'
  | 'direct'
  | 'negative'
  | 'executor01'
  | 'executor02'
  | 'executor03'
  | 'executor-weth'
  | 'simple-swap'
  | 'multi-swap'
  | 'mega-swap'
  | 'vertical-branch'
  | 'sell'
  | 'buy'
  | 'approval-present'
  | 'approval-missing'
  | 'weth-deposit'
  | 'weth-withdraw'
  | 'weth-only'
  | 'same-token-internal-split'
  | 'permit2-approval'
  | 'transfer-src-token-before-swap'
  | 'need-unwrap-native'
  | 'fee-nonzero'
  | 'fee-take-surplus'
  | 'fee-surplus-to-user'
  | 'fee-direct-transfer'
  | 'fee-referrer'
  | 'permit-nonempty'
  | 'zero-quoted-amount'
  | 'native-source'
  | 'validation-error';
```

### Fixture Directory Layout

Recommended layout:

```text
tests/generic-swap-transaction-builder/fixtures/resolved-build/
  generic/
    executor01-simple-sell-approved.json
    executor01-simple-sell-approval-missing.json
    executor01-eth-weth-deposit.json
    executor01-weth-eth-withdraw.json
    executor01-multiswap-sell.json
    executor02-vertical-branch-sell.json
    executor02-multiswap-sell.json
    executor02-megaswap-sell.json
    executor03-buy.json
    weth-only-eth-to-weth.json
    same-token-internal-split.json
    permit2-approval.json
    transfer-src-token-before-swap.json
    need-unwrap-native.json
    fee-nonzero-partner.json
    fee-referrer.json
    fee-take-surplus.json
    fee-surplus-to-user.json
    fee-direct-transfer.json
    edge-nonempty-permit.json
    edge-zero-quoted-amount.json
  direct/
    uniswap-v2-sell.json
    uniswap-v2-buy.json
    uniswap-v3-sell.json
    uniswap-v3-buy.json
    balancer-v2-sell.json
    balancer-v2-buy.json
    curve-v1-sell.json
    curve-v2-sell.json
    lite-psm.json
    augustus-rfq-try-batch-fill.json
  negative/
    duplicate-resolved-leg.json
    malformed-address.json
    malformed-amount.json
    malformed-weth-plan.json
    non-boolean-need-wrap-native.json
    unsupported-generic-method.json
    unsupported-direct-method.json
    direct-side-method-mismatch.json
    executor-address-mismatch.json
```

The exact filenames can change during implementation, but the final fixture
set should make coverage obvious from the filename and `coverage` tags.

`generic/` and `direct/` success fixtures must include `orchestration` metadata
so public-builder parity can be replayed. A success fixture without
`orchestration` must set `boundaryOnly: true` and explain why with
`boundaryOnlyReason`. `negative/` fixtures normally omit `orchestration` and
are boundary-loader tests only.

Fee and edge-value fixtures are coverage dimensions rather than separate top-
level fixture kinds. Keep them under `generic/` or `direct/` depending on which
boundary path they exercise, and use `coverage` tags to make their purpose
machine-checkable.

### Canonical JSON Serialization

Fixtures must be written with one canonical serializer:

```ts
JSON.stringify(value, recursiveKeySortReplacer, 2) + '\n';
```

The replacer must recursively sort object keys, preserve array order, and omit
keys whose value is `undefined`. This rule is part of the fixture contract so
fixture bytes are deterministic across generator runs and reviewer machines.

### Generator Strategy

Prefer extracting the phase 3 and phase 4 parity helpers into reusable test
utilities first. The fixture generator should call those helpers with
deterministic data, write JSON with stable key order, and then the fixture test
should read the committed JSON back.

The generator is snapshot-and-commit, not hand-author-by-default. It should run
the TypeScript orchestrator with deterministic mocks, capture the actual
`BuildInput` or `DirectBuildInput` passed to the resolved boundary, run the
boundary to produce `expectedParams` and `expectedTx`, and write the committed
fixture. Manual fixture editing should be reserved for narrow flag mutations or
explicitly reviewed authored scenarios.

Do not use live chain state while generating fixtures. Approval behavior should
come from explicit fixture metadata, not `skipApprovalCheck` alone:

- approval-present fixtures should set approval decisions to `true`
- approval-missing fixtures should set approval decisions to `false` and
  include expected `approveData`
- mixed multi-leg approval fixtures should list one boolean per approval pair

For WETH fixtures, include the already-resolved `wethPlan` calldata. The
fixture should not call a live WETH depositor/withdrawer or infer calldata from
chain state.

For direct fixtures, store the resolved direct params returned by mocked or
fixture-backed `getDirectParamV6()`. Direct fixtures should also assert
side/method consistency for directional methods so the phase 4 regression guard
remains covered by golden data.

Side/method consistency must be validated by the fixture loader, not only by the
generator. Loader-side validation protects committed fixtures on every test run.

Required generator/check commands:

```bash
yarn fixtures:generate
yarn fixtures:check
```

`yarn fixtures:check` should run the generator and then fail if committed
fixture bytes changed:

```bash
yarn fixtures:generate
git diff --exit-code -- tests/generic-swap-transaction-builder/fixtures/resolved-build
```

This check should be part of CI once Phase 5 lands.

### Test Utility And Playback Policy

Shared fixture helpers should live under
`tests/generic-swap-transaction-builder/fixtures/` alongside the JSON fixture
root, not inside the `resolved/` test-case folder. The `resolved/` folder should
contain tests; the fixture folder should contain reusable fixture schema,
generator, loader, and diff utilities.

After Phase 5, fixture playback owns the cross-language boundary contract.
In-memory tests should remain only for orchestration-specific assertions that
fixtures cannot express well, such as `getDirectParamV6()` call arguments,
approval-pair construction, and DEX/WETH lookup behavior. Avoid maintaining
duplicate in-memory tests whose only assertion is already covered by a golden
fixture.

Fixture playback should include a failure helper for `tx.data` mismatches. When
outer Augustus calldata differs, decode the function name and params with the
Augustus V6 ABI, print params element-by-element, and highlight the first
different element. Raw 4KB hex string diffs are not useful for boundary
regressions.

### Fixture Playback Dependencies

Fixture playback must not recreate mutable application wiring. Add deterministic
dependency factories that construct only the resolved-boundary dependencies from
fixture data:

```ts
function createResolvedBuildDeps(input: BuildInput): ResolvedBuildDeps;
function createDirectResolvedBuildDeps(
  input: DirectBuildInput,
): ResolvedDirectBuildDeps;
```

`createResolvedBuildDeps(input)` should derive the executor bytecode builder
from `input.executorType` and a fixture-safe encoding context built only from
serialized boundary fields:

- `input.network`
- `input.augustusV6Address`
- `input.wrappedNativeTokenAddress`
- `input.executorAddress`
- a deterministic `isWETH(address)` implementation based on
  `input.wrappedNativeTokenAddress`
- a no-op logger

It must use the repo Augustus V6 ABI for `augustusV6Interface`. It must not
read live `DexAdapterService`, chain RPC, mutable config files, current
executor config, current token-transfer proxy config, or live approval state.

`createDirectResolvedBuildDeps(input)` should only provide the repo Augustus V6
ABI interface. Direct fixture playback must not reconstruct DEX adapters or use
DEX-returned encoder functions; direct params are already serialized in
`input.params`.

Success fixture playback should use these dependency factories for boundary
assertions, then use `orchestration` metadata only for the separate public
`GenericSwapTransactionBuilder.build()` replay. Boundary-only success fixtures
skip the public-builder replay by design and must explain why.

### Coverage Notes From Phases 1-4

Already covered in in-memory parity tests and ready to convert to golden
fixtures:

- Executor01 simple SELL with approvals present
- Executor01 simple SELL with approval missing
- Executor01 ETH -> token WETH deposit
- Executor01 token -> ETH WETH withdraw
- Executor01 multiswap SELL
- Executor02 vertical branch SELL
- Executor02 multiswap SELL
- Executor03 BUY
- WETH-only ETH -> WETH
- Direct UniswapV2 SELL and BUY
- Direct UniswapV3 SELL
- Direct BalancerV2 BUY
- Direct CurveV1 SELL
- Direct LitePsm
- Direct Augustus RFQ try-batch-fill

Still needs authored or located data before Phase 5 is complete:

- Executor02 mega swap fixture, because phase 3 deferred it when existing
  Executor02 price-route fixtures all had `bestRoute.length === 1`
- same-token-pair internal split
- `permit2Approval`
- `transferSrcTokenBeforeSwap`
- `needUnwrapNative`
- Direct UniswapV3 BUY, BalancerV2 SELL, and CurveV2 SELL golden fixtures
- Fee fixtures for:
  - `partnerFeePercent` non-zero
  - `takeSurplus: true`
  - `isSurplusToUser: true`
  - `isDirectFeeTransfer: true`
  - `referrerAddress` set
- Edge fixtures for:
  - non-empty `permit`
  - `NULL_ADDRESS` beneficiary behavior
  - zero `quotedAmount` where the ABI and boundary allow it
- Negative fixtures for each boundary validation family:
  - duplicate resolved leg
  - missing resolved leg
  - out-of-route resolved leg
  - malformed lowercase address
  - malformed decimal amount
  - malformed hex bytes
  - non-boolean `needWrapNative`
  - malformed WETH plan
  - unsupported generic/direct method
  - executor address mismatch
  - invalid direct side
  - direct side/method mismatch

The `permit2Approval`, `transferSrcTokenBeforeSwap`, and `needUnwrapNative`
fixtures can be one-line `DexExchangeBuildParam` flag mutations of existing
route fixtures when that exercises the boundary semantics. They do not require
new route families unless the executor behavior demands it.

The Executor02 mega-swap fixture must be meaningful: at least two top-level
routes, and at least one route must include a vertical branch
(`swapExchanges.length > 1`). Avoid a degenerate two-route fixture that does
not exercise Executor02 mega traversal and branch concatenation.

### Snapshot Baseline

The phase 3 note about executor snapshot suites still applies. If Phase 5 adds
or changes shared fixtures under `src/executor/fixtures/`, the corresponding
snapshot suites must compile and pass. If the existing snapshot cast baseline is
still broken, keep Phase 5 golden fixtures under
`tests/generic-swap-transaction-builder/fixtures/` and avoid shared fixture
churn until the snapshot baseline is fixed.

## Phase 5 Tasks

| Status | Task                               | Notes                                                                                                                                                                                                                                        |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done   | Confirm fixture root and schema    | Added schema/types under `tests/generic-swap-transaction-builder/fixtures/` and fixtures under `tests/generic-swap-transaction-builder/fixtures/resolved-build/`.                                                                            |
| Done   | Separate fixture contract metadata | Added `getGoContractFixtureFields()` so Go-facing fields exclude TypeScript-only `orchestration`, `boundaryOnly`, and `boundaryOnlyReason`.                                                                                                  |
| Done   | Define coverage tag enum           | Added controlled `CoverageTag` vocabulary and loader rejection for unknown tags.                                                                                                                                                             |
| Done   | Add negative fixture schema        | Added `{ kind: 'negative', input, expectedError }` support plus schema-version validation.                                                                                                                                                   |
| Done   | Extract reusable fixture helpers   | Added reusable generic/direct public-builder replay helpers in `resolved-build-fixture-cases.ts`.                                                                                                                                            |
| Done   | Add fixture dependency factories   | Added deterministic `createResolvedBuildDeps(input)` and `createDirectResolvedBuildDeps(input)` helpers that construct only boundary deps from serialized fixture inputs.                                                                    |
| Done   | Add stable JSON writer/generator   | Added generator and canonical writer using sorted keys, 2-space JSON, trailing newline, omitted `undefined`, deterministic local mocks, and captured actual boundary input.                                                                  |
| Done   | Add fixture determinism command    | Added `yarn fixtures:generate` and `yarn fixtures:check`; `fixtures:check` now catches untracked generated fixture files and `yarn checks` includes it.                                                                                      |
| Done   | Convert existing generic coverage  | Persisted phase 2-3 generic coverage as golden fixtures for Executor01, Executor02, Executor03, WETH deposit/withdraw, approval missing, and WETH-only paths.                                                                                |
| Done   | Convert existing direct coverage   | Persisted phase 4 direct representative cases with nested tuple params and explicit side-derived encoder byte parity.                                                                                                                        |
| Done   | Add missing generic fixtures       | Added heterogeneous Executor02 mega swap, same-token internal split, `permit2Approval`, `transferSrcTokenBeforeSwap`, `needUnwrapNative`, and non-null beneficiary fixtures.                                                                 |
| Done   | Complete direct allowlist fixtures | Added missing UniswapV3 BUY, BalancerV2 SELL, and CurveV2 SELL fixtures; all 10 current V6 direct methods are covered.                                                                                                                       |
| Done   | Add fee and edge fixtures          | Added non-zero partner fee, take-surplus, surplus-to-user, direct-fee-transfer, referrer, non-empty permit, NULL/non-null beneficiary, native source, and zero quoted amount coverage.                                                       |
| Done   | Add negative validation fixtures   | Added 13 negative fixtures covering duplicate/missing/out-of-route legs, malformed fields, unsupported methods, executor mismatch, and direct side errors.                                                                                   |
| Done   | Add fixture playback tests         | Added JSON-driven playback tests that assert boundary output for every success fixture, public-builder parity for every non-boundary-only success fixture, and exact negative errors.                                                        |
| Done   | Add decoded calldata diff helper   | Added Augustus V6 calldata decode helper that reports function and first differing param for `tx.data` mismatches.                                                                                                                           |
| Done   | Validate fixture determinism       | `yarn fixtures:generate` is deterministic; `fixtures:check` now also rejects untracked fixture files and should pass once generated fixtures are tracked.                                                                                    |
| Done   | Update docs with fixture inventory | Recorded inventory and snapshot decision below.                                                                                                                                                                                              |
| Done   | Run checks                         | `yarn fixtures:generate`, `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`, `yarn check:tsc`, and `yarn check:es` passed on 2026-05-13. `yarn fixtures:check` was verified to fail while fixture files are untracked. |

### Phase 5 Completion Notes

- Added 45 golden fixtures under
  `tests/generic-swap-transaction-builder/fixtures/resolved-build/`:
  22 generic success fixtures, 10 direct success fixtures, and 13 negative
  validation fixtures.
- Generic fixture inventory:
  `edge-nonempty-permit`, `edge-zero-quoted-amount`,
  `executor01-eth-weth-deposit`, `executor01-multiswap-sell`,
  `executor01-simple-sell-approval-missing`,
  `executor01-simple-sell-approved`, `executor01-simple-sell-beneficiary`,
  `executor01-weth-eth-withdraw`, `executor02-megaswap-sell`,
  `executor02-multiswap-sell`,
  `executor02-vertical-branch-sell`, `executor03-buy`,
  `fee-direct-transfer`, `fee-nonzero-partner`, `fee-referrer`,
  `fee-surplus-to-user`, `fee-take-surplus`, `need-unwrap-native`,
  `permit2-approval`, `same-token-internal-split`,
  `transfer-src-token-before-swap`, and `weth-only-eth-to-weth`.
- Direct fixture inventory:
  `augustus-rfq-try-batch-fill`, `balancer-v2-buy`, `balancer-v2-sell`,
  `curve-v1-sell`, `curve-v2-sell`, `lite-psm`, `uniswap-v2-buy`,
  `uniswap-v2-sell`, `uniswap-v3-buy`, and `uniswap-v3-sell`.
- Negative fixture inventory:
  `direct-side-method-mismatch`, `duplicate-resolved-leg`,
  `executor-address-mismatch`, `invalid-direct-side`, `malformed-address`,
  `malformed-amount`, `malformed-hex-bytes`, `malformed-weth-plan`,
  `missing-resolved-leg`, `non-boolean-need-wrap-native`,
  `out-of-route-resolved-leg`, `unsupported-direct-method`, and
  `unsupported-generic-method`.
- All generic and direct success fixtures include TypeScript-only
  `orchestration` metadata and are replayed through
  `GenericSwapTransactionBuilder.build()` for both normal tx and `onlyParams`.
  No success fixture is currently marked `boundaryOnly`.
- `orchestration` stores deterministic replay data directly in the fixture
  JSON. The loader exposes Go-facing contract fields separately so Go consumers
  can ignore this metadata.
- The generator records the actual `BuildInput` / `DirectBuildInput` passed by
  `GenericSwapTransactionBuilder.build()` to the resolved boundary through a
  test observer, and fixture input is written from that captured value.
- Direct fixture generation asserts each direct boundary calldata is
  byte-identical to the mocked DEX encoder output.
- `same-token-internal-split` now contains two `swapExchanges` on the same
  token pair and exercises Executor02 vertical-branch handling.
- The Executor02 mega-swap fixture is authored from local deterministic route
  data with two heterogeneous top-level ETH -> USDC routes:
  `SushiSwapV3/SushiSwapV3/BalancerV1` at 91% and `UniswapV3` at 9%. Its
  serialized WETH deposit plan is the sum of both precomputed deposit plans.
  It does not use RPC or shared executor snapshot fixture churn.
- Negative fixtures are generated from name-selected base fixtures rather than
  positional array entries. `executor-address-mismatch` is self-contained in
  fixture input; playback no longer uses coverage tags as control metadata.
- Fixture playback enforces required fixture names, verifies every declared
  coverage tag is used at least once, and no longer depends on a brittle exact
  fixture count.
- `tests/generic-swap-transaction-builder/fixtures/resolved-build/README.md`
  documents that `expectedParams`, `expectedTx`, and negative `expectedError`
  values are generated and describes the schema-version migration policy.
- No Phase 5 scenarios were deferred. The shared `src/executor/fixtures/`
  snapshot baseline was left untouched; Phase 5 fixtures live under the
  test-owned fixture root only.

## Phase 5 Acceptance Criteria

- Golden fixtures are committed and loadable without RPC or remote network
  access.
- Every fixture has `schemaVersion`, `kind`, `input`, `expectedParams`, and
  `expectedTx`; negative fixtures instead have `expectedError`.
- Fixture loaders reject unsupported `schemaVersion` values and unknown
  `coverage` tags.
- Go-facing fixture consumers ignore `orchestration`, and TypeScript fixture
  tests use it only for public-builder replay.
- Generic fixtures include the coverage required by `implementation.md`:
  Executor01 simple/multiswap, Executor02 vertical/mega, Executor03 BUY,
  WETH-only, same-token internal split, ETH/WETH deposit and withdraw,
  `permit2Approval`, `transferSrcTokenBeforeSwap`, and `needUnwrapNative`.
- Direct fixtures cover every current V6 direct allowlist method:
  UniswapV2 in/out, UniswapV3 in/out, BalancerV2 in/out, CurveV1 in,
  CurveV2 in, LitePsm, and Augustus RFQ try-batch-fill.
- Fixture playback asserts both `expectedParams` and `expectedTx`.
- Public builder parity is replayed for every success fixture unless it is
  explicitly marked `boundaryOnly: true` with `boundaryOnlyReason`.
- Every `generic/` and `direct/` success fixture includes `orchestration`;
  any exception must be marked `boundaryOnly`; `negative/` fixtures do not need
  public-builder orchestration.
- Fixture playback uses deterministic `createResolvedBuildDeps(input)` and
  `createDirectResolvedBuildDeps(input)` helpers rather than live
  `DexAdapterService`, RPC, mutable config, or current approval state.
- Approval-present and approval-missing behavior is represented with explicit
  approval decisions.
- Fee packing has fixture coverage for non-zero partner fee, take-surplus,
  surplus-to-user, direct-fee-transfer, and referrer paths.
- Edge-value coverage includes non-empty permit and native source value
  behavior, plus any valid zero-value fields chosen for the fixture set.
- Negative fixtures cover boundary validation errors and assert exact
  `expectedError` strings.
- WETH plans use precomputed calldata and values.
- Fixtures follow canonical JSON serialization with recursive key sorting,
  2-space indentation, omitted `undefined` keys, and trailing newline.
- `yarn fixtures:check` passes, proving the generator produces no diff when
  inputs are unchanged.
- Existing phase 1-4 resolved-boundary tests still pass.
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

Phase 4:

```bash
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Phase 5:

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Optional manual phase 5 determinism check after the generator exists:

```bash
yarn fixtures:generate
git diff --exit-code -- tests/generic-swap-transaction-builder/fixtures/resolved-build
```

Optional manual phase 4 sanity after merge:

```bash
# Run one representative V6 direct E2E simulation, for example a UniswapV2 direct test.
# Exact command/filter depends on the local Tenderly-enabled test setup.
```

Optional phase 3 snapshot check after fixing the pre-existing snapshot fixture
cast baseline:

```bash
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
```
