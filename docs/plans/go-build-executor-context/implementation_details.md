# Go Build Executor Context: Implementation Details

This document breaks `docs/plans/go-build-executor-context/implementation.md`
into reviewable implementation phases. The goal is to remove the synthetic
`OptimalRate`/`IDexHelper` dependency from resolved-boundary executor encoding
without changing public builder behavior or fixture JSON.

## Current State

- `GenericSwapTransactionBuilder.build()` already routes generic transaction
  assembly through `buildTransactionFromResolved()`.
- The resolved boundary still adapts `BuildInput.routePlan` back into a
  synthetic `OptimalRate` before calling executor builders.
- Executor builders still take `IDexHelper` in their constructors and use
  `dexHelper.config.*` during bytecode encoding.
- Executor snapshot suites are currently not an executable gate because their
  fixture casts pass `DexExchangeParam[]` where builders expect
  `DexExchangeBuildParam[]`.
- WETH is a special executor address case: config has Executor01/02/03
  addresses, while WETH bytecode uses the wrapped native token address.
- The snapshot compile failure has been verified with:
  `yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand`.

## Execution Rule

If a phase's acceptance gate fails, revert that phase's commits and fix the
phase plan before retrying. Do not patch forward into the next phase to recover
from a broken phase boundary.

## Phase 1: Restore Executor Snapshot Baseline

### Goal

Make existing executor snapshot tests compile and pass before changing encoder
interfaces, so later failures represent this refactor rather than pre-existing
test debt.

### Tasks

1. Confirm whether known downstream repos use deep imports of
   `src/executor/*`; if any do, record the compatibility note and coordination
   needed before changing builder constructor signatures.
2. Update `executor01-bytecode-builder-snapshot.test.ts` and
   `executor02-bytecode-builder-snapshot.test.ts` casts/helpers so exchange
   params are treated as `DexExchangeBuildParam[]`.
3. Ensure every snapshot exchange param used by these suites has boolean
   `needWrapNative`.
4. Do not change executor implementation behavior or snapshots unless a
   legitimate stale snapshot is discovered.

### Acceptance

```bash
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
yarn check:tsc
yarn check:es
```

### Status

Completed on 2026-05-14.

- Deep-import check: searched the local Paraswap workspace for
  `@paraswap/dex-lib/src/executor`, `paraswap-dex-lib/src/executor`, and
  `src/executor/(Executor|WETH)`. No downstream code deep-imports were found;
  matches were limited to this repo's tests and Go migration notes.
  - Scope: `/Users/danylokaniev/work/paraswap`, covering all locally checked
    out repos under that root.
  - Package roots observed during the scan included `paraswap-api`,
    `paraswap-sdk`, `paraswap-ui`, `paraswap-augustus`, `paraswap-contracts`,
    `paraswap-core`, `paraswap-dex-lib`, `paraswap-dex-lib-private`,
    `paraswap-limit-orders`, `paraswap-limit-orders-service`,
    `paraswap-pooltracker`, `paraswap-rpc`, `paraswap-staking`,
    `paraswap-configuration-service`, `paraswap-health-checker-service`,
    `paraswap-initialization-service`, `paraswap-volume-tracker`,
    `paraswap-gas-fetcher`, `cross-chain/across-*`, `solver/paraswap-solver-js`,
    `portikus/*`, and `other/*`.
  - Exclusions: `node_modules`, `build`, `dist`, `.git`, `__snapshots__`, and
    `docs/plans`.
  - Command shape:
    `rg --no-messages -n "@paraswap/dex-lib/src/executor|paraswap-dex-lib/src/executor|src/executor/(Executor|WETH)" /Users/danylokaniev/work/paraswap --glob '!**/node_modules/**' --glob '!**/build/**' --glob '!**/dist/**' --glob '!**/.git/**' --glob '!**/__snapshots__/**' --glob '!**/docs/plans/**'`
- Snapshot test baseline restored:
  - executor snapshot tests now pass fixtures as `DexExchangeBuildParam[]`
  - each snapshot fixture exchange param is guarded to require boolean
    `needWrapNative`
  - tests use a minimal config-backed `IDexHelper` stub instead of
    `DummyDexHelper`, avoiding the `PromiseScheduler` timer open handle
  - shared snapshot helpers live in
    `src/executor/__test-utils__/snapshot-test-helpers.ts`; the logger stub
    includes `debug`, `info`, `warn`, and `error`, and the
    `masterCachePrefix` argument is named because it is unused by these tests
- Snapshot files were refreshed after the suite became executable. This was
  treated as legitimate stale snapshot debt: no executor implementation behavior
  changed in this phase, and all 28 current builder outputs are now locked.
  The refreshed outputs now include the current mainnet Augustus V6 address
  `0x6a000f20005980200259b80c5102003040001068`; the old snapshots still
  contained stale `0xc2c80254789711a17391f295b6285dee1233d368` bytes in
  positions that now encode Augustus V6. The current executor exchange-param
  fixtures also do not contain `approveData`, so branches guarded by
  `curExchangeParam.approveData` no longer emit approval-specific calldata in
  these snapshots.
- Acceptance commands passed:
  - `yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand`
  - `yarn check:tsc`
  - `yarn check:es`

## Phase 2: Add Executor Encoding Context And Shared Types

### Goal

Introduce the Go-shaped runtime inputs and helpers without changing executor
builder call sites yet.

### Tasks

1. Add executor-owned encoding types under `src/executor/encoding-types.ts` or an
   equivalent executor-owned module:
   - `ExecutorEncodingContext`
   - `ExecutorEncodingLogger`
   - `ExecutorBytecodeBuildInput`
   - route-plan, route-position, and `ResolvedLeg` types currently owned by
     the resolved module
   - ordered-leg output type for route-position plus matched `ResolvedLeg`
2. Move route traversal helpers into executor-owned encoding code:
   `buildRoutePlan`, `flattenRoutePlan`, `walkRoutePlan`, `routePositionKey`,
   and `getRoutePlanLegCount`.
3. Re-export moved route-plan and `ResolvedLeg` types/helpers from the resolved
   boundary module so fixture JSON and existing resolved imports stay stable.
4. Add `createNoopExecutorEncodingLogger()`.
5. Add `createExecutorEncodingContextFromDexHelper(dexHelper)`:
   - lowercases `augustusV6Address`, `wrappedNativeTokenAddress`, and every
     executor address
   - synthesizes `executorsAddresses[Executors.WETH]` from
     `wrappedNativeTokenAddress`
   - exposes `isWETH(address)` using normalized comparison
   - wires `logger.warn` to
     `dexHelper.getLogger('ExecutorBytecodeBuilder').warn`
6. Add `getOrderedExecutorLegs(routePlan, resolvedLegs)` as the only helper that
   flattens route positions to resolved legs for executor encoding.
7. Add `getApprovalTokenAndTarget(swap, exchangeParam, context)` as a pure helper
   but leave existing builder method in place temporarily if needed.
8. Add focused unit tests for the new helpers:
   - `getOrderedExecutorLegs` preserves `walkRoutePlan()` order and throws on
     missing legs.
   - `createExecutorEncodingContextFromDexHelper` lowercases all addresses,
     synthesizes the WETH executor entry, and compares `isWETH(address)` with
     normalized casing.
   - `getApprovalTokenAndTarget` matches the current builder-method behavior
     for `skipApproval`, `needUnwrapNative` with WETH source,
     ETH-source/`needWrapNative`, and `transferSrcTokenBeforeSwap`.

### Acceptance

```bash
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
yarn check:tsc
yarn check:es
```

No fixture JSON should change.

### Status

Completed on 2026-05-14.

- Added executor-owned encoding primitives:
  - `src/executor/encoding-types.ts` owns `ExecutorEncodingContext`,
    `ExecutorEncodingLogger`, `ExecutorBytecodeBuildInput`, route-plan types,
    `ResolvedLeg`, and ordered-leg output.
  - `src/executor/route-plan.ts` owns `buildRoutePlan`, `flattenRoutePlan`,
    `walkRoutePlan`, `routePositionKey`, `getRoutePlanLegCount`, and
    `getOrderedExecutorLegs`.
  - `src/executor/encoding-context.ts` owns the no-op logger and the
    `IDexHelper` adapter. The adapter lowercases executor context addresses,
    synthesizes `Executors.WETH` from `wrappedNativeTokenAddress`, normalizes
    `isWETH`, and forwards logger methods from
    `dexHelper.getLogger('ExecutorBytecodeBuilder')`.
  - `src/executor/approval.ts` owns the pure
    `getApprovalTokenAndTarget()` helper.
- `src/generic-swap-transaction-builder/resolved/types.ts` and
  `src/generic-swap-transaction-builder/resolved/route-plan.ts` now re-export
  the moved executor-owned shapes/helpers so existing resolved imports and
  fixture JSON remain stable.
- Added `src/executor/encoding-helpers.test.ts` covering ordered-leg traversal,
  missing-leg rejection, context normalization/WETH synthesis/logger wiring,
  the no-op logger shape, and approval-helper parity with the current executor
  builder method.
- Follow-up review findings were addressed before Phase 3:
  - approval parity now covers explicit `wethAddress`, unwrap on a non-WETH
    source, wrap plus transfer-before-swap, and skip-approval short-circuiting
  - context creation fails with explicit missing-address errors for
    `augustusV6Address` and `wrappedNativeTokenAddress`
  - a configured `executorsAddresses.WETH` must match the wrapped native token
    address instead of being silently ignored
  - `getOrderedExecutorLegs()` rejects duplicate and out-of-route resolved-leg
    positions; ordered-leg tests cover single-leg, mega-route, and empty
    route-plan cases
  - comments document the mixed-case test config and bound logger methods
- Acceptance commands passed:
  - `yarn jest src/executor/encoding-helpers.test.ts --runInBand`
  - `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
  - `yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand`
  - `yarn check:tsc`
  - `yarn check:es`
- No fixture JSON or executor snapshots changed.

## Phase 3: Refactor Executor Builders To Context Inputs

### Goal

Make Executor01/02/03/WETH bytecode builders depend on
`ExecutorEncodingContext` and `ExecutorBytecodeBuildInput` rather than
`IDexHelper`, `OptimalRate`, and separate flat exchange params.

### Tasks

1. Change `ExecutorBytecodeBuilder` constructor to take
   `ExecutorEncodingContext`.
2. Replace all `this.dexHelper.config.*` reads with context fields or
   `context.isWETH(address)`.
3. Replace logger access with required `context.logger.warn`.
4. Replace `buildByteCode(priceRoute, exchangeParams, sender, wethPlan)` with
   `buildByteCode(input: ExecutorBytecodeBuildInput)`.
5. Use `getOrderedExecutorLegs()` to produce the flat traversal used for flags,
   exchange params, approvals, and swap-exchange indexes.
6. Preserve Executor03 behavior: it may reorder entries by `needWrapNative`, but
   it must retain the original `swapExchangeIndex` from ordered-leg output.
7. Update `WETHBytecodeBuilder`; its bytecode remains `0x`, but its constructor,
   `getAddress()`, and `buildByteCode()` signature must match the new base
   class. `getAddress()` must return
   `context.executorsAddresses[Executors.WETH]`, which the context adapter
   guarantees equals `context.wrappedNativeTokenAddress`.
8. Add `createExecutorBytecodeBuilder(executorType, context)` for all four
   executor types.
9. Update `ExecutorDetector` in the same phase so the repo keeps compiling:
   either make it route-only for executor selection or route any remaining
   builder construction through `createExecutorBytecodeBuilder(type, context)`.
   Do not leave it constructing builders with `IDexHelper` after builder
   constructors change.
10. Update `tests/generic-swap-transaction-builder/fixtures/resolved-build-deps.ts`
    if needed so resolved-boundary fixture helpers continue compiling after
    constructor and factory changes.
11. Update executor snapshot tests to build an `ExecutorEncodingContext` and call
    the new `buildByteCode(input)` shape.

### Acceptance

```bash
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
yarn check:es
```

Snapshots should not change. If they do, treat the diff as a refactor bug until
proven intentional.

The resolved fixture suite is required in Phase 3 specifically to cover
Executor03 `needWrapNative` reordering and WETH address behavior, because there
are no dedicated Executor03/WETH snapshot suites today.

## Phase 4: Wire Resolved Boundary And Orchestration

### Goal

Remove the synthetic `OptimalRate` adapter from the resolved boundary and route
public-builder orchestration through context-backed encoding.

### Tasks

1. Change `ResolvedBuildDeps` to `{ encodingContext, augustusV6Interface }`.
2. In `buildTransactionFromResolved()`:
   - validate `input.executorAddress` against
     `encodingContext.executorsAddresses[input.executorType]`
   - create the bytecode builder with
     `createExecutorBytecodeBuilder(input.executorType, encodingContext)`
   - pass `ExecutorBytecodeBuildInput` directly to `buildByteCode()`
   - delete `buildExecutorCompatiblePriceRoute()`
3. In `GenericSwapTransactionBuilder`:
   - construct one `ExecutorEncodingContext` from `dexAdapterService.dexHelper`
   - keep `ExecutorDetector.getExecutorByPriceRoute(priceRoute)` for route-only
     executor selection
   - stop using `ExecutorDetector.getBytecodeBuilder()` in the
     resolved-boundary path
   - pass selected executor address instead of a bytecode builder into resolved
     call construction
   - update `getExecutionContractAddress(priceRoute)` to resolve direct methods
     to Augustus V6 and generic methods to
     `context.executorsAddresses[selectedExecutorType]`, including the
     synthesized WETH entry
   - update `addDexExchangeApproveParams()` to use
     `getApprovalTokenAndTarget(swap, exchangeParam, context)` and the selected
     executor address as spender. The spender must be
     `context.executorsAddresses[selectedExecutorType]`, the same value used by
     executor-address validation.
4. Update fixture helpers and resolved tests that currently call
   `bytecodeBuilder.getApprovalTokenAndTarget(...)`:
   - `tests/generic-swap-transaction-builder/fixtures/resolved-build-fixture-cases.ts`
   - `tests/generic-swap-transaction-builder/resolved/build-transaction.test.ts`
5. Remove `getApprovalTokenAndTarget` from `ExecutorBytecodeBuilder` once all
   callers use the pure helper.
6. Update `tests/generic-swap-transaction-builder/fixtures/resolved-build-deps.ts`
   to create `ResolvedBuildDeps` with an encoding context, not
   `ExecutorDetector`.

### Acceptance

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
yarn check:tsc
yarn check:es
```

No committed fixture JSON should change.

## Phase 5: Final Verification And Documentation

### Goal

Confirm the refactor is behavior-preserving and update documentation with the
actual final shape.

### Tasks

1. Run final checks.
2. Reconcile `implementation.md` with the implemented shape, regardless of
   whether interface names changed.
3. Record completion notes in this file with commands run and any deferred work.

### Acceptance

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand
yarn check:tsc
yarn check:es
```

## Non-Goals

- Do not add a Go module in this pass.
- Do not change public SDK/build APIs.
- Do not change fixture schema/version.
- Do not move DEX-specific `getDexParam` or `getDirectParamV6` logic.
- Do not change route pricing, executor selection semantics, or approval
  decisioning behavior.
