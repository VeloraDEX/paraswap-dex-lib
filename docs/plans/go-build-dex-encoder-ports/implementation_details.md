# Go Build DEX Encoder Ports: Implementation Details

This document breaks `docs/plans/go-build-dex-encoder-ports/implementation.md`
into reviewable implementation phases. The goal is to prepare
`GenericSwapTransactionBuilder` orchestration for future in-process Go DEX
encoder implementations without porting DEX-specific encoder logic in this
pass.

## Current State

- `GenericSwapTransactionBuilder` generic orchestration still reads
  `IDexTxBuilder.needWrapNative`, calls `getDexParam()`, and then builds
  resolved `BuildInput`.
- Direct V6 orchestration still calls `IDexTxBuilder.getDirectParamV6()` before
  constructing `DirectBuildInput`.
- WETH deposit/withdraw calldata still comes from the WETH DEX instance through
  `dexAdapterService.getTxBuilderDexByKey(...).getDepositWithdrawParam(...)`.
- The legacy `newDexs` / `fetchRemoteDexParam` remote path still exists in
  `GenericSwapTransactionBuilder`, but it is not part of the future
  architecture and must be removed before ports are introduced.
- Resolved boundary fixtures already cover
  `BuildInput` / `DirectBuildInput -> TxObject`; this plan adds a lower-level
  DEX encoder conformance surface for future Go DEX packages.

## Execution Rule

Each phase must leave the repo compiling and passing that phase's acceptance
gate before the next phase starts. If a phase's acceptance gate fails, revert
that phase's changes and fix the phase plan before retrying. Do not patch
forward into later phases to recover from a broken boundary.

## Phase 0: Contract Audit And Legacy Remote Cleanup

### Goal

Freeze the Go-facing DEX encoder DTO contracts and remove the legacy remote
`newDexs` path from `GenericSwapTransactionBuilder`.

### Tasks

1. Enumerate all V6-reachable DEXes with function-shaped `needWrapNative`
   implementations under `src/dex/**`.
2. Record the exact JSON fields required by `NeedWrapNativeInput`, including
   route, swap, swap-exchange, side, network, amount, token, and data fields.
3. Define normalization rules for every DTO:
   - lowercase address fields
   - decimal-string amount fields
   - `0x`-prefixed hex calldata/bytes fields
   - DEX-owned `swapExchange.data` pass-through behavior
4. Finalize `DexExchangeParam` strictness:
   - required and optional fields
   - optional-vs-null handling
   - `specialDexFlag` values or reserved range semantics
   - unknown-field behavior
5. Add type-only TS interface stubs for audited DTOs in the future dex-encoder
   module so the audit output is TypeScript-checked instead of prose-only.
   Phase 2 extends this module with final port interfaces.
6. Add `AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES` in the dex-encoder module with
   every V6-reachable DEX that has function-shaped `needWrapNative`.
7. Remove `newDexsApiUrl`, `newDexs`, `NewDexsConfig`, `findNewDex()`,
   `fetchRemoteDexParam()`, and the remote Joi schema from
   `GenericSwapTransactionBuilder`.
8. Define the new `GenericSwapTransactionBuilder` constructor shape after
   removing `newDexsApiUrl` / `newDexs`, and update every call site. Prefer an
   options object for optional args such as `skipApprovalCheck` and
   `resolvedBuildInputObserver` to avoid positional `undefined` placeholders.
9. Collapse `buildResolvedCalls()` to a single native DEX lookup branch after
   the legacy remote branch is removed.
10. Resolve any cspell noise left by removing `newDexs`; rewrite remaining prose
    to `DEXes` where needed.

### Acceptance

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Phase 0 is complete only when:

- exact DTO field lists and normalization rules are documented
- audited DTO interface stubs compile
- `AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES` is committed as the recorded audit
  list
- `DexExchangeParam` strictness policy is documented
- `newDexs` / `fetchRemoteDexParam` is removed from
  `GenericSwapTransactionBuilder`
- every `GenericSwapTransactionBuilder` constructor call site uses the new
  constructor shape

### Status

Complete.

- Added the Phase 0 dex-encoder module with audited DTO stubs,
  normalization/strictness policy constants, and
  `AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES`.
- Added field-level DTO contracts for address, amount, calldata,
  nullable-input, pass-through, and strict-output fields.
- Recorded the function-shaped `needWrapNative` audit list as
  `CurveV1Factory` and `CurveV1StableNg`.
- Removed the legacy `newDexs` / `fetchRemoteDexParam` branch and remote Joi
  schema from `GenericSwapTransactionBuilder`.
- Removed Metric and Tessera e2e assertions that still posted to the retired
  remote dex-param endpoint; those tests now retain only route execution
  coverage.
- Replaced positional constructor placeholders with
  `GenericSwapTransactionBuilderOptions` and updated local call sites.
- Verified with:
  - `yarn fixtures:check`
  - `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
  - `yarn check:tsc`
  - `yarn check:es`

## Phase 1: Extract Pure Orchestration Helpers

### Goal

Extract deterministic orchestration logic from `GenericSwapTransactionBuilder`
before introducing port adapters, so the later `dex.X -> port.X` diff is
smaller and easier to review.

### Tasks

1. Extract quoted amount defaulting into a pure helper.
2. Extract beneficiary normalization into a pure helper.
3. Extract permit defaulting into a pure helper.
4. Extract `getDexCallsParams()` into a pure generic DEX call-param
   normalization helper.
5. Extract WETH plan aggregation into a pure helper that receives a minimal
   local callback/interface for WETH calldata. Phase 4 replaces this callback
   with `WethCallDataProviderPort`.
6. Extract `addDexExchangeApproveParams()` into an approval-enrichment helper
   that applies already-known approval decisions.
7. Unify V6 fee packing into one shared function located with resolved
   transaction assembly code, currently `resolved/build-transaction.ts`, and
   import it from direct orchestration.

### Acceptance

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/orchestration.test.ts --runInBand
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Phase 1 is complete only when:

- extracted helpers have focused unit tests
- generic and direct paths use the same V6 fee packer
- fixture diffs are treated as refactor bugs unless intentionally accepted

### Status

Complete.

- Added `src/generic-swap-transaction-builder/orchestration.ts` with pure
  helpers for quoted amount, beneficiary, permit, generic DEX call params, WETH
  plan aggregation, approval request/decision application, and WETH/native route
  wrap-mode inspection.
- Routed `GenericSwapTransactionBuilder.buildResolvedCalls()` through the pure
  DEX call param and WETH aggregation helpers while keeping WETH calldata as a
  local callback; Phase 4 can replace that callback with
  `WethCallDataProviderPort`.
- Routed approval side effects through pure request/decision helpers: the class
  still owns `augustusApprovals.hasApprovals(...)`, and the helper applies the
  already-known decisions to resolved legs.
- Exported the resolved-boundary `buildFeesV6()` helper and removed the
  duplicate direct-path fee packer from `GenericSwapTransactionBuilder`.
- Added focused helper tests under
  `tests/generic-swap-transaction-builder/orchestration.test.ts`.
- Verified with:
  - `yarn jest tests/generic-swap-transaction-builder/orchestration.test.ts --runInBand`
  - `yarn fixtures:check`
  - `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
  - `yarn check:tsc`
  - `yarn check:es`

## Phase 2: Define Port DTOs And Interfaces

### Goal

Add the V6 DEX encoder port types without changing runtime behavior.

### Tasks

1. Extend the Phase 0 dex-encoder module, for example:
   `src/generic-swap-transaction-builder/dex-encoder/`.
2. Extend the audited type stubs into final serializable DTOs:
   - `NeedWrapNativeInput`
   - `DexParamInput`
   - `DexExchangeParam`
   - `DirectParamInput`
   - `DirectParamResult`
   - `WethDepositWithdrawInput`
     `DexParamInput` must include the route/swap/swap-exchange context needed to
     resolve returned function-typed `DexExchangeParam.needWrapNative`, mirroring
     the fields audited for `NeedWrapNativeInput`.
3. Define ports:
   - `DexEncoderPort`
   - `DirectDexEncoderPort`
   - `DexEncoderRegistryPort`
   - `WethCallDataProviderPort`
4. Add a port-independent V6 direct method helper.
5. Add or reserve a separate `DexExchangeParamContract` name only if a distinct
   versioned schema object is introduced; keep `DexExchangeParam` as the
   runtime DTO name.
6. Define WETH provider construction as:
   `createWethCallDataProvider(context: ExecutorEncodingContext): WethCallDataProviderPort`.
7. Document dependency direction: the dex-encoder module may import executor
   types such as `ExecutorEncodingContext`, but executor modules must not import
   dex-encoder code.

### Acceptance

```bash
yarn check:tsc
yarn check:es
```

Phase 2 is complete only when DTOs and port interfaces compile without runtime
behavior changes.

### Status

Complete.

- Added `DexEncoderPort`, `DirectDexEncoderPort`,
  `DexEncoderRegistryPort`, `WethCallDataProviderPort`, and lookup/factory
  types under `src/generic-swap-transaction-builder/dex-encoder/ports.ts`.
- Added port-independent V6 direct method helpers under
  `src/generic-swap-transaction-builder/dex-encoder/direct-methods.ts`,
  including the direct method list, direct method type guard, and fixed-side
  lookup.
- Routed resolved direct-boundary validation through the shared direct-method
  helper so there is one direct-method source of truth.
- Tightened `DirectParamInput.contractMethod` to the V6 direct-method union.
- Added serializable WETH calldata output DTOs and field contracts for the WETH
  provider port, including address/amount/calldata/number/boolean field
  categories.
- Reserved the WETH provider factory type and documented that Phase 4 introduces
  the `createWethCallDataProvider(...)` value implementation.
- Documented the dependency direction in the port module: dex-encoder may
  import executor context types for construction signatures, but executor
  modules must not import dex-encoder code.
- Verified with:
  - `yarn check:tsc`
  - `yarn check:es`
  - `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`

## Phase 3: Capture DEX Encoder Conformance Fixtures

### Goal

Capture pre-port TS DEX encoder behavior before orchestration is routed through
the new ports.

### Tasks

1. Add a DEX encoder conformance fixture format under
   `tests/generic-swap-transaction-builder/dex-encoder/` with:
   - `schemaVersion`
   - `kind`
   - `network`
   - `dexKey`
   - `contractMethod` for `direct-param` fixtures
   - `input`
   - `expected`
2. Support fixture kinds:
   - `need-wrap-native`
   - `dex-param`
   - `direct-param`
3. Add fixture loader validation for both `input` and `expected`.
4. Add loader rejection tests for unsupported schema versions and unknown kinds.
5. Capture baseline V6 encoder fixtures from the current TS path, without
   requiring RPC.
6. Include DEX-specific `swapExchange.data` fixture schemas where needed.

### Acceptance

```bash
yarn jest tests/generic-swap-transaction-builder/dex-encoder --runInBand
yarn check:tsc
yarn check:es
```

Phase 3 is complete only when conformance fixtures lock pre-port TS behavior and
fixture loaders validate both sides of every fixture. Minimum coverage is every
DEX used by the resolved-boundary fixture suite, plus every V6 direct DEX
covered by current direct fixture tests.

### Status

Not started.

## Phase 4: Add TS Adapter Over Existing DEX Builders

### Goal

Implement the port interfaces with adapters over current TS DEX builders and
prove the adapters match the Phase 3 conformance fixtures.

### Tasks

1. Add a per-network TS registry adapter backed by the existing per-network
   `DexAdapterService`.
2. Implement `DexEncoderPort.needWrapNative(input)` by adapting static or
   function-typed `IDexTxBuilder.needWrapNative`.
3. Implement `DexEncoderPort.getDexParam(input)` by adapting existing
   `getDexParam(...)`.
4. Resolve returned function-typed `DexExchangeParam.needWrapNative` inside the
   adapter using the route context embedded in `DexParamInput`; the port must
   return boolean-only `needWrapNative`.
5. Normalize sync and async DEX methods to `Promise<...>`.
6. Validate returned `DexExchangeParam`.
7. Implement direct encoder lookup with method-aware rejection for unsupported
   DEX/method pairs.
8. Ensure direct adapter output does not expose an `encoder` callback and does
   not carry `contractMethod`.
9. Add `WethCallDataProviderPort` implementation that wraps current WETH
   `getDepositWithdrawParam(...)` behavior.
10. Promote `buildResolvedWethPlan` and its call path to await the port's
    `MaybePromise` WETH calldata return.

### Acceptance

```bash
yarn jest tests/generic-swap-transaction-builder/dex-encoder --runInBand
yarn check:tsc
yarn check:es
```

Phase 4 is complete only when:

- all Phase 3 conformance fixtures pass through the TS adapter
- adapter tests cover static/function-typed `needWrapNative`, sync/async
  `getDexParam`, missing DEX methods, direct method rejection, and WETH
  calldata provider parity
- this phase proves the TS adapter preserves current TS behavior; future Go DEX
  encoder conformance is a separate gate

### Status

Not started.

## Phase 5: Refactor Generic Orchestration To Use Ports

### Goal

Route `GenericSwapTransactionBuilder.buildResolvedCalls()` through the generic
DEX encoder and WETH calldata ports while preserving behavior for non-`newDexs`
callers.

### Tasks

1. Replace direct `dex.needWrapNative` reads in `buildResolvedCalls()` with
   `dexEncoderRegistry.getDexEncoder(...).needWrapNative(input)`.
2. Replace direct `dex.getDexParam(...)` calls with
   `dexEncoder.getDexParam(input)`.
3. Replace WETH calldata lookup through
   `dexAdapterService.getTxBuilderDexByKey(...).getDepositWithdrawParam(...)`
   with `WethCallDataProviderPort`.
4. Keep WETH planning and approval enrichment outside the resolved transaction
   boundary.
5. Keep `BuildInput` shape unchanged.
6. Add a unit test backed by a deterministic TypeScript-aware scanner, not an
   ad hoc regex. The scanner must parse `src/dex/**/*.ts`, detect class
   properties or assignments named `needWrapNative` whose initializer is a
   function, arrow function, or method-like function value, and assert every
   V6-reachable match is listed in
   `AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES`. Extend the same audit suite with
   a `SpecialDex` enum-vs-`KNOWN_SPECIAL_DEX_FLAGS` parity assertion.
7. Before flipping `buildResolvedCalls()`, capture orchestration-level generic
   `BuildInput` baselines via `ResolvedBuildInputObserver`.
8. Add orchestration parity tests showing the port-routed generic path creates
   the same `BuildInput` as the captured generic orchestration baselines.

### Acceptance

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Phase 5 is complete only when:

- generic orchestration parity passes against captured baselines
- existing resolved-boundary fixtures still pass
- the function-typed `needWrapNative` audit unit test passes

### Status

Not started.

## Phase 6: Refactor Direct Orchestration To Use Ports

### Goal

Route `_buildDirect()` through `DirectDexEncoderPort` while preserving direct
V6 behavior.

### Tasks

1. Keep direct-route shape validation unchanged.
2. Build `DirectParamInput` for the selected DEX and V6 direct method.
3. Call `directDexEncoder.getDirectParamV6(input)`.
4. Build `DirectBuildInput` from the returned direct params.
5. Carry `contractMethod` from the input route into `DirectBuildInput`; the
   port result does not include `contractMethod`.
6. Keep final tx assembly in `buildDirectTransactionFromResolved()`.
7. Verify every V6 direct DEX receives the same `partnerAndFee` value in
   `DirectParamInput` as it received before the port refactor, and that returned
   params incorporate it as before.
8. Before flipping `_buildDirect()`, capture orchestration-level direct
   `DirectBuildInput` baselines via `ResolvedBuildInputObserver`.
9. Add orchestration parity tests showing the port-routed direct path creates
   the same `DirectBuildInput` as the captured direct orchestration baselines.

Phase 6 is independent from Phase 5 after Phase 4 lands and may run in parallel
with the generic orchestration refactor if write scopes stay disjoint.

### Acceptance

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn jest tests/generic-swap-transaction-builder/dex-encoder --runInBand
yarn check:tsc
yarn check:es
```

Phase 6 is complete only when direct orchestration parity passes against
captured baselines and existing resolved-boundary fixtures still pass. The
dex-encoder suite is rerun here as a regression guardrail; Phase 6 should not
intentionally change dex-encoder adapter behavior.

### Status

Not started.

## Non-Goals

- Do not implement any DEX-specific `getDexParam()` logic in Go.
- Do not implement any DEX-specific `getDirectParamV6()` logic in Go.
- Do not add a Go module in this pass.
- Do not move DEX-specific calldata generation into the resolved transaction
  boundary.
- Do not change the public `build()` API.
- Do not keep or redesign `fetchRemoteDexParam` as a sidecar strategy.
