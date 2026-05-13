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
- `_build()` currently owns executor selection, executor bytecode generation,
  `partnerAndFee`, generic Augustus V6 params, and generic V6 calldata encoding.
- `buildCalls()` currently mixes DEX param resolution, `needWrapNative`
  function resolution, normalized per-leg amounts/tokens, WETH planning,
  approval enrichment, and executor bytecode construction.
- `_buildDirect()` delegates direct V6 param construction to DEX-specific
  `getDirectParamV6()` implementations. Direct swaps should remain outside
  phase 1 except for type shape notes.
- Phase 1 implementation note: current `OptimalSwap` objects do not carry
  swap-level `srcAmount`/`destAmount` fields. `buildRoutePlan()` preserves any
  such fields if present and otherwise derives swap-level amounts by summing
  the nested `swapExchanges` amount strings. Per-exchange amount strings are
  copied unchanged.
- `Executor01BytecodeBuilder`, `Executor02BytecodeBuilder`, and
  `Executor03BytecodeBuilder` still consume `OptimalRate` plus a flat
  `DexExchangeBuildParam[]`. The first implementation should not refactor these
  builders yet. A later phase can replace the compatibility adapter with a
  route-plan-native bytecode path.
- Existing executor snapshot fixtures under `src/executor/fixtures/` already
  cover useful route shapes and can be reused for route-plan conversion tests.
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

## Suggested Test Commands

```bash
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
yarn check:tsc
```
