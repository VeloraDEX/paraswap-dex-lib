# Go Build Executor Context: Implementation Plan

## Summary

Refactor executor bytecode encoding so the resolved boundary calls encoders with
Go-shaped route/leg data and a minimal encoding context, instead of passing a
synthetic `OptimalRate` and `IDexHelper`-backed builders. Public SDK behavior,
fixture JSON shape, and `GenericSwapTransactionBuilder.build()` arguments stay
unchanged.

## Key Changes

- Add executor-owned encoding primitives:

  - `ExecutorEncodingContext`: `network`, `augustusV6Address`,
    `wrappedNativeTokenAddress`, `executorsAddresses`, `isWETH(address)`, and
    required `logger.warn`.
  - `createNoopExecutorEncodingLogger()` returning `{ warn: () => undefined }`
    for tests and non-logging call sites.
  - `ExecutorBytecodeBuildInput`: `routePlan`, `resolvedLegs`, `sender`,
    optional `wethPlan`, and only the top-level route fields currently read by
    executor encoding: `srcToken`, `destToken`, and `destAmount`.
  - `createExecutorEncodingContextFromDexHelper(dexHelper)` adapter for
    orchestration code only. The adapter lowercases all `executorsAddresses`
    entries, synthesizes `executorsAddresses[Executors.WETH]` from
    `wrappedNativeTokenAddress`, and wires
    `dexHelper.getLogger('ExecutorBytecodeBuilder').warn`.
  - `createExecutorBytecodeBuilder(type, context)` factory for
    `Executor01BytecodeBuilder`, `Executor02BytecodeBuilder`,
    `Executor03BytecodeBuilder`, and `WETHBytecodeBuilder`.
  - `getApprovalTokenAndTarget(swap, exchangeParam, context)` pure helper,
    extracted from the current base builder method.
  - `getOrderedExecutorLegs(routePlan, resolvedLegs)` shared helper that walks
    `routePlan` order, returns each route position with its matching
    `ResolvedLeg`, and is the only source for flat exchange-param traversal.

- Move route-plan, route-position, and `ResolvedLeg` shapes to executor-level
  encoding types and re-export them from the resolved boundary types so fixture
  JSON stays identical. Put the shared types under
  `src/executor/encoding-types.ts` (or an equivalent executor-owned module) and
  have `resolved/` import/re-export them; do not make executor code import types
  from `resolved/`.

- Move route-plan helpers to executor-owned encoding code and re-export them
  from the resolved boundary: `buildRoutePlan`, `flattenRoutePlan`,
  `walkRoutePlan`, `routePositionKey`, and `getRoutePlanLegCount`. This keeps
  executor ordering logic independent from the resolved-boundary package while
  preserving existing resolved imports during the refactor.

- Change executor builders to depend on `ExecutorEncodingContext`:

  - Constructor takes `ExecutorEncodingContext`, not `IDexHelper`.
  - Replace `this.dexHelper.config.*` reads with context helpers.
  - Replace `buildByteCode(priceRoute, exchangeParams, sender, wethPlan)` with
    `buildByteCode(input: ExecutorBytecodeBuildInput)`.
  - Replace internal `OptimalRate`, `OptimalSwap`, and `OptimalSwapExchange`
    references with route-plan types.
  - Update `WETHBytecodeBuilder` too; its bytecode stays `0x`, but its
    constructor, `getAddress()`, and polymorphic `buildByteCode` signature must
    match the other builders.

- Update resolved boundary wiring:

  - `ResolvedBuildDeps` becomes `{ encodingContext, augustusV6Interface }`.
  - `buildTransactionFromResolved(input, deps)` validates executor address
    against `encodingContext.executorsAddresses[input.executorType]`.
    `Executors.WETH` must validate against the synthesized WETH address entry,
    which equals `context.wrappedNativeTokenAddress`.
  - It creates the bytecode builder with
    `createExecutorBytecodeBuilder(input.executorType, encodingContext)`.
  - Delete `buildExecutorCompatiblePriceRoute()` on purpose and pass
    `routePlan + resolvedLegs` directly into executor encoding.
  - `ExecutorEncodingContext` is runtime-only and never appears in fixture JSON.

- Simplify `GenericSwapTransactionBuilder` orchestration:
  - Build one `ExecutorEncodingContext` from `dexAdapterService.dexHelper` in
    the constructor.
  - Split executor selection from builder construction: keep
    `ExecutorDetector.getExecutorByPriceRoute(priceRoute)` as route-only
    executor selection and stop using `ExecutorDetector.getBytecodeBuilder()`
    in the resolved-boundary path. All context-backed builder construction
    happens through `createExecutorBytecodeBuilder(type, context)`.
  - Pass executor address, not a bytecode builder, into resolved-call
    construction.
  - Update `getExecutionContractAddress(priceRoute)` to resolve direct methods
    to Augustus V6 and generic methods to
    `context.executorsAddresses[selectedExecutorType]`, including the
    synthesized WETH entry.
  - `addDexExchangeApproveParams` no longer takes a `bytecodeBuilder`; it calls
    `getApprovalTokenAndTarget(swap, exchangeParam, context)` directly and uses
    the selected executor address as the approval spender.
  - Update tests and fixture helpers that currently call
    `bytecodeBuilder.getApprovalTokenAndTarget(...)` to call the pure helper.

## Test Plan

- First fix the existing executor snapshot compile baseline: update
  `executor01-bytecode-builder-snapshot.test.ts` and
  `executor02-bytecode-builder-snapshot.test.ts` fixtures/casts so they pass
  `DexExchangeBuildParam[]` with boolean `needWrapNative`, not
  `DexExchangeParam[]`. Do this before treating those suites as acceptance
  gates.
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn fixtures:check`
- `yarn jest src/executor/executor01-bytecode-builder-snapshot.test.ts src/executor/executor02-bytecode-builder-snapshot.test.ts --runInBand`
- `yarn check:tsc`
- `yarn check:es`

No fixture JSON should change. Treat fixture diffs as refactor bugs unless
intentionally accepted.

The ordered-leg helper is acceptance-critical: executor flags and exchange-param
indices must preserve the current `walkRoutePlan()` order. Executor03 may still
reorder by `needWrapNative`, but it must retain each original
`swapExchangeIndex` from the shared ordered-leg output.

Executor03 and WETH behavior are covered by the resolved fixture suite. Add
dedicated Executor03/WETH snapshot tests only if new executor-owned snapshots are
introduced during the refactor.

## Assumptions

- No Go module is added in this pass.
- No public SDK/build API changes.
- Fixture schema/version remains `1`.
- Direct resolved build is unchanged except shared type imports if needed.
- Existing executor builders are not exported from the package root, but before
  execution verify whether any known downstream repo uses deep imports of
  `src/executor/*`; if so, coordinate the signature change.
