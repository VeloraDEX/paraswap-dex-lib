# Go Build DEX Encoder Ports: Implementation Plan

## Summary

Prepare `GenericSwapTransactionBuilder` orchestration for future in-process Go
DEX encoder implementations without porting any DEX-specific encoder logic in
this pass. The goal is to introduce stable ports, DTOs, and conformance test
surfaces so Go can later import and use separately implemented `getDexParam()`
and `getDirectParamV6()` equivalents behind the same contracts.

This plan assumes DEX-specific calldata generation will be implemented
separately in Go. It does not use a TS sidecar as the primary migration path.
The existing `fetchRemoteDexParam` / `newDexs` path was added for partial
migration support for new DEXes and is not part of the future architecture.
This plan removes that path from `GenericSwapTransactionBuilder` before adding
ports.

## Goals

- Decouple transaction-builder orchestration from TS `IDexTxBuilder` instances.
- Define explicit DTOs for generic DEX param, direct DEX param, and
  `needWrapNative` evaluation.
- Move WETH deposit/withdraw calldata behind an explicit provider port.
- Preserve current `GenericSwapTransactionBuilder.build()` behavior for
  non-`newDexs` callers; the legacy remote path is removed in Phase 0.
- Keep the resolved transaction boundary unchanged:
  `BuildInput` / `DirectBuildInput -> TxObject`.
- Add a conformance fixture format that future Go DEX encoder packages can use
  independently from full transaction-builder tests.

## Non-Goals

- Do not implement any `getDexParam()` logic in Go.
- Do not implement any `getDirectParamV6()` logic in Go.
- Do not remove existing TS DEX implementations.
- Do not add a Go module unless a later plan explicitly scopes it.
- Do not move DEX-specific calldata generation into the resolved transaction
  boundary.
- Do not change the public `build()` API. Constructor-only cleanup is required
  to remove `newDexs` / `fetchRemoteDexParam` plumbing.
- Do not implement, extend, or design around `fetchRemoteDexParam` as a
  sidecar strategy.

## Target Shape

The orchestration layer should depend on DEX encoder ports, not directly on
`dexAdapterService.getTxBuilderDexByKey()` or `IDexTxBuilder` methods.

Conceptual Go shape:

```go
type DexEncoder interface {
    NeedWrapNative(input NeedWrapNativeInput) (bool, error)
    GetDexParam(input DexParamInput) (DexExchangeParam, error)
}

type DirectDexEncoder interface {
    GetDirectParamV6(input DirectParamInput) (DirectParamResult, error)
}

type DexEncoderRegistry interface {
    GetDexEncoder(network int, dexKey string) (DexEncoder, error)
    GetDirectDexEncoder(network int, dexKey string, method string) (DirectDexEncoder, error)
}

type WethCallDataProviderPort interface {
    GetDepositWithdrawParam(input WethDepositWithdrawInput) (DepositWithdrawReturn, error)
}
```

TypeScript should mirror this shape first with adapters over the current DEX
classes. Future Go orchestration can use equivalent interfaces backed by Go DEX
packages. `WethCallDataProviderPort` is constructed from per-network encoding
context and uses `wrappedNativeTokenAddress` for deposits. V6 withdraw output
uses `NULL_ADDRESS` as the serialized callee because the executor consumes the
withdraw calldata, not a legacy WETH DEX callee.

Direct-method classification remains a port-independent helper based on the
current V6 direct method list. The direct registry is responsible for rejecting
DEX/method pairs that do not have a direct encoder.

## Key Contracts

### NeedWrapNativeInput

Carries the serializable route context needed to evaluate current
`needWrapNative` functions. The exact field list must be frozen by the Phase 0
contract audit before implementation starts.

- network
- dex key / exchange name
- side
- top-level route fields required by audited implementations
- route index, swap index, swap-exchange index
- current swap tokens and amounts
- current swap-exchange exchange, percent, amounts, and data

The result must be a boolean. Function-typed `needWrapNative` must not cross
into `ResolvedLeg.exchangeParam`.

All address fields in this DTO must use normalized lowercase hex strings. All
amount fields must be decimal strings in wei. `swapExchange.data` is DEX-owned
JSON and is passed through unchanged; DEX-specific conformance fixtures may add
per-DEX schemas for that JSON.

### DexParamInput

Carries the already normalized inputs currently passed to
`dex.getDexParam(...)`:

- dex key / exchange name
- src token
- dest token
- src amount
- dest amount
- recipient
- swap-exchange data
- side
- executor address
- route position metadata for diagnostics
- embedded route/swap/swap-exchange context needed to resolve a returned
  function-typed `DexExchangeParam.needWrapNative`. This should mirror the
  fields audited for `NeedWrapNativeInput` so `getDexParam(input)` is
  self-contained.

The result is `DexExchangeParam` with boolean `needWrapNative`. If the wrapped
TS DEX returns function-typed `DexExchangeParam.needWrapNative`, the TS adapter
must resolve it before returning. Future Go DEX implementations must return a
boolean directly.

`swap-exchange data` flows through as JSON unchanged from price-route
serialization. DEX-specific deserialization and validation are the DEX
encoder's responsibility on both TS and Go sides.

### DexExchangeParam

Define a versioned contract suitable for TS and Go code generation or manual
parity:

- schema version
- required fields:
  - `needWrapNative`
  - `exchangeData`
  - `targetExchange`
  - `dexFuncHasRecipient`
- optional fields:
  - `needUnwrapNative`
  - `skipApproval`
  - `wethAddress`
  - `specialDexFlag`
  - `transferSrcTokenBeforeSwap`
  - `spender`
  - `sendEthButSupportsInsertFromAmount`
  - `specialDexSupportsInsertFromAmount`
  - `swappedAmountNotPresentInExchangeData`
  - `returnAmountPos`
  - `insertFromAmountPos`
  - `amountsPacked128`
  - `permit2Approval`

The contract should make optional-vs-null behavior explicit. If unknown fields
remain allowed for compatibility, document which consumers may ignore them.
It must also pin:

- lowercase address expectations for address-valued fields
- `0x` hex validation for calldata/bytes fields
- decimal-string validation for amount-like values
- `specialDexFlag` known values or reserved range semantics
- whether unknown fields are preserved, rejected, or ignored

### DirectParamInput

Carries the inputs currently passed to `dex.getDirectParamV6(...)`:

- dex key / exchange name
- src token
- dest token
- src amount
- dest amount
- quoted amount
- swap-exchange data
- side
- permit
- uuid
- partner-and-fee
- beneficiary
- block number
- contract method

### DirectParamResult

Carries direct DEX output without relying on TS closures:

- params

The result should not contain an `encoder` callback. Encoding final Augustus V6
calldata remains the responsibility of `buildDirectTransactionFromResolved()`.
Current V6 direct build orchestration ignores `TxInfo.networkFee`, so it is not
part of this contract. Add it later only if a caller needs it.

`contractMethod` is intentionally omitted from the result. It is already present
in `DirectParamInput` and `DirectBuildInput`; carrying it in the encoder result
would create a second source of truth.

### WethDepositWithdrawInput

Carries the values currently passed to `Weth.getDepositWithdrawParam(...)`:

- source WETH amount to deposit
- destination WETH amount to withdraw
- swap side

The result is the existing `DepositWithdrawReturn` shape. The provider is
constructed with per-network encoding context so addresses do not need to be
repeated on every call. The TS provider should encode WETH deposit/withdraw
calldata directly and use `NULL_ADDRESS` as the V6 withdraw callee; this is
stable ABI logic and is not a DEX-specific port. This provider is V6-only by
definition; do not carry a
ParaSwap version field unless a future plan scopes multi-version support.

## Port Semantics

- The TS port methods always return `Promise<...>`, even when the wrapped DEX
  implementation is synchronous.
- TS port methods throw `Error` on invalid input, missing DEX support, or
  invalid encoder output. Go implementations should map these cases to returned
  `error` values.
- The only `IDexTxBuilder` surface included in these ports is:
  - `needWrapNative`
  - `getDexParam`
  - `getDirectParamV6`
- WETH deposit/withdraw calldata is intentionally not part of `IDexTxBuilder`
  ports; it uses `WethCallDataProviderPort`.
- Do not include unrelated DEX hooks such as `getNetworkFee`,
  `preProcessTransaction`, or `needsSequentialPreprocessing`.
- The TS adapter is per-network and backed by the existing per-network
  `DexAdapterService`. A higher-level network-aware registry can create or
  select these adapters lazily if a caller needs multi-network routing.
- WETH calldata provider construction should use:
  `createWethCallDataProvider(context: ExecutorEncodingContext): WethCallDataProviderPort`.

## Implementation Phases

### Phase 0: Contract Audit And Legacy Remote Cleanup

Before adding ports, freeze the exact Go-facing DTO contracts:

- enumerate the exact `NeedWrapNativeInput` JSON fields from current
  function-typed `needWrapNative` implementations
- define address normalization and decimal-string amount rules for every DTO
- document `swapExchange.data` pass-through rules and any DEX-specific fixture
  schemas needed for top DEXes
- finalize `DexExchangeParam` strictness, including `specialDexFlag`, hex
  validation, optional/null handling, and unknown-field behavior
- create type-only TS interface stubs for the audited DTOs in the dex-encoder
  module so the audit output is checked by TypeScript instead of living only in
  prose. Phase 2 extends this module with final port interfaces.
- remove `newDexsApiUrl`, `newDexs`, `NewDexsConfig`, `findNewDex()`,
  `fetchRemoteDexParam()`, and the remote Joi schema from
  `GenericSwapTransactionBuilder`
- define the new `GenericSwapTransactionBuilder` constructor shape and update
  all call sites. Prefer moving optional arguments such as `skipApprovalCheck`
  and `resolvedBuildInputObserver` behind an options object to avoid future
  positional placeholder churn.

`fetchRemoteDexParam` must not be reimplemented as a port and must not influence
the Go-facing encoder contracts.

Acceptance:

- exact DTO field lists and normalization rules are documented
- audited DTO interface stubs compile in the dex-encoder module
- `DexExchangeParam` strictness policy is documented
- `newDexs` / `fetchRemoteDexParam` is removed from
  `GenericSwapTransactionBuilder`
- all `GenericSwapTransactionBuilder` constructor call sites are updated to the
  new constructor shape
- `yarn fixtures:check`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn check:tsc`
- `yarn check:es`

### Phase 1: Extract Pure Orchestration Helpers

Extract small pure helpers from `GenericSwapTransactionBuilder` before changing
DEX access:

- quoted amount defaulting
- beneficiary normalization
- permit defaulting
- `getDexCallsParams()` into a pure generic DEX call-param normalization helper
- WETH plan aggregation using a minimal local callback/interface for WETH
  calldata; Phase 4 replaces that callback with `WethCallDataProviderPort`
- `addDexExchangeApproveParams()` into an approval-enrichment helper that
  applies already-known approval decisions
- one shared V6 fee packer used by both the resolved generic boundary and direct
  orchestration before `getDirectParamV6()`

These helpers should accept explicit inputs and return plain objects. This phase
can land independently from the port work and reduces the size of later
`dex.X -> port.X` diffs. The shared V6 fee packer should live with the resolved
transaction assembly code, currently `resolved/build-transaction.ts`, and be
imported by direct orchestration.

Acceptance:

- extracted helpers have focused unit tests
- generic and direct paths use the same V6 fee packer
- `yarn fixtures:check`
- `yarn jest tests/generic-swap-transaction-builder/orchestration.test.ts --runInBand`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn check:tsc`
- `yarn check:es`

### Phase 2: Define Port DTOs And Interfaces

Extend the Phase 0 dex-encoder module with final port interfaces, for example:

```text
src/generic-swap-transaction-builder/dex-encoder/
```

Define:

- `NeedWrapNativeInput`
- `DexParamInput`
- `DexExchangeParam`
- `DirectParamInput`
- `DirectParamResult`
- `DexEncoderPort`
- `DirectDexEncoderPort`
- `DexEncoderRegistryPort`
- `WethDepositWithdrawInput`
- `WethCallDataProviderPort`
- port-independent V6 direct method helper

The V6 direct method helper should be the canonical direct-method source of
truth. Resolved direct-boundary validation should use it instead of maintaining
a parallel direct-method list or side map.

Keep these types serializable where practical. Any non-serializable field must
be justified and kept out of future Go-facing contracts. If a separate
`DexExchangeParamContract` name is introduced, reserve it for the versioned
schema object and keep `DexExchangeParam` as the runtime DTO name.

Acceptance:

- DTOs and port interfaces compile without changing runtime behavior
- `yarn check:tsc`
- `yarn check:es`

### Phase 3: Capture DEX Encoder Conformance Fixtures

Add the DEX encoder conformance fixture format before routing orchestration
through the ports, so fixtures lock pre-port TS behavior.

```json
{
  "schemaVersion": 1,
  "kind": "dex-param",
  "network": 1,
  "dexKey": "UniswapV3",
  "input": {},
  "expected": {}
}
```

Recommended fixture kinds:

- `need-wrap-native`
- `dex-param`
- `direct-param`

Every fixture must include top-level `network` and `dexKey` fields. Direct
fixtures must also include top-level `contractMethod`, because direct encoder
registry lookup is method-aware.

These fixtures should be independent from the full transaction builder and
should not require RPC. They should lock the encoder contracts that Go DEX
packages must satisfy later. Fixture loaders must validate both `input` and
`expected`.

Acceptance:

- fixture generation captures pre-port TS DEX behavior
- fixture loader validates both `input` and `expected`
- fixture loader rejects unsupported schema versions and unknown kinds
- `yarn jest tests/generic-swap-transaction-builder/dex-encoder --runInBand`
- `yarn check:tsc`
- `yarn check:es`

### Phase 4: Add TS Adapter Over Existing DEX Builders

Implement a registry adapter around current TS infrastructure:

- wraps `dexAdapterService.getTxBuilderDexByKey(key)`
- evaluates static or function-typed `needWrapNative`
- calls existing `getDexParam(...)`
- calls existing `getDirectParamV6(...)`
- normalizes async/sync DEX methods into `Promise<...>`
- resolves returned function-typed `DexExchangeParam.needWrapNative` using the
  route context embedded in `DexParamInput`
- validates returned `DexExchangeParam`
- throws when a DEX or direct method is unsupported

This adapter is the compatibility layer. Existing DEX implementations should not
be changed in this phase except for small type fixes needed by the adapter.

Also add a TS `WethCallDataProviderPort` implementation that directly encodes
V6 WETH deposit/withdraw calldata and emits `NULL_ADDRESS` as the withdraw
callee. This requires promoting `buildResolvedWethPlan` and its call path to
await the port's `MaybePromise` WETH calldata return.

Acceptance:

- conformance fixtures captured in Phase 3 pass through the TS adapter
- TS adapter tests cover static/function-typed `needWrapNative`, async/sync
  `getDexParam`, missing DEX methods, direct method rejection, and WETH calldata
  provider parity
- `yarn jest tests/generic-swap-transaction-builder/dex-encoder --runInBand`
- `yarn check:tsc`
- `yarn check:es`

### Phase 5: Refactor Generic Orchestration To Use Ports

Update `GenericSwapTransactionBuilder.buildResolvedCalls()` so it depends on
the port:

- replace direct `dex.needWrapNative` access with
  `dexEncoderRegistry.getDexEncoder(...).needWrapNative(input)`
- replace direct `dex.getDexParam(...)` calls with
  `dexEncoder.getDexParam(input)`
- keep WETH planning and approval enrichment outside the resolved transaction
  boundary
- keep `BuildInput` shape unchanged
- replace WETH calldata lookup through
  `dexAdapterService.getTxBuilderDexByKey(...).getDepositWithdrawParam(...)`
  with `WethCallDataProviderPort`
- verify every V6-reachable DEX with function-typed `needWrapNative` is covered
  by the Phase 0 audit; block migration if any are missed. Verification should
  use a deterministic TypeScript-aware test helper, not an ad hoc regex. The
  helper should parse `src/dex/**/*.ts`, detect class properties or assignments
  named `needWrapNative` whose initializer is a function, arrow function, or
  method-like function value, and cross-reference every V6-reachable match
  against the audited list from Phase 0.
- assert `KNOWN_SPECIAL_DEX_FLAGS` stays in lockstep with the `SpecialDex`
  enum.

Acceptance:

- orchestration parity tests show the port-routed generic path creates the same
  `BuildInput` as the pre-port path
- existing resolved-boundary fixtures still pass
- every V6-reachable function-typed `needWrapNative` DEX is covered by the
  Phase 0 audit
- `KNOWN_SPECIAL_DEX_FLAGS` matches the `SpecialDex` enum
- `yarn fixtures:check`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn check:tsc`
- `yarn check:es`

### Phase 6: Refactor Direct Orchestration To Use Ports

Update `_buildDirect()` so it depends on `DirectDexEncoderPort`:

- validate direct-route shape as today
- build `DirectParamInput`
- call `directDexEncoder.getDirectParamV6(input)`
- build `DirectBuildInput` from the returned direct params
- keep `contractMethod` from the input route, not from the port result
- keep final tx assembly in `buildDirectTransactionFromResolved()`

This phase should remove direct orchestration dependence on
`IDexTxBuilder.getDirectParamV6()` while preserving behavior.
Phase 6 is independent from Phase 5 after Phase 4 lands; it may run in parallel
with the generic orchestration refactor if write scopes stay disjoint.

Acceptance:

- orchestration parity tests show the port-routed direct path creates the same
  `DirectBuildInput` as the pre-port path
- existing resolved-boundary fixtures still pass
- `yarn fixtures:check`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn jest tests/generic-swap-transaction-builder/dex-encoder --runInBand`
- `yarn check:tsc`
- `yarn check:es`

## Test Plan

- Existing resolved-boundary fixtures must continue passing:

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
```

- Add focused unit tests for the TS adapter:

  - static `needWrapNative`
  - function-typed `needWrapNative`
  - missing `getDexParam`
  - returned `DexExchangeParam` validation
  - async and sync `getDexParam` implementations
  - missing `getDirectParamV6`
  - unsupported direct method for a DEX
  - direct params without encoder callback leakage
  - WETH calldata provider output, including `NULL_ADDRESS` withdraw callee

- Add orchestration parity tests proving `GenericSwapTransactionBuilder.build()`
  output is unchanged for non-`newDexs` callers after routing through the ports:

  - capture `BuildInput` / `DirectBuildInput` via
    `ResolvedBuildInputObserver`
  - compare the port-routed path against orchestration baselines captured
    immediately before the Phase 5/6 flips; Phase 3 captures only DEX
    encoder-level fixtures
  - a temporary dual-path harness may compare old path and port-routed path
    with `toEqual` during the refactor
  - run existing transaction-builder integration tests that cover build output

- Add conformance fixture loader tests:

  - rejects unsupported schema version
  - rejects unknown fixture kind
  - validates top-level `network` and `dexKey`
  - validates top-level `contractMethod` on direct-param fixtures
  - validates fixture `input`
  - validates fixture `expected`
  - validates generic `DexExchangeParam` required fields
  - validates method-specific direct param fixtures
  - validates DEX-specific `swapExchange.data` fixture schemas when present

- Resolve cspell noise from this plan as part of Phase 0: delete identifiers
  with the legacy remote path, and rewrite remaining prose to `DEXes` where
  needed.

## Migration Notes

- `needWrapNative` is evaluated before `getDexParam()` because it affects
  normalized tokens, recipient selection, and WETH deposit/withdraw accounting.
  Future Go DEX implementations must expose this decision separately or through
  a higher-level leg resolver before generic DEX params are requested.
- `getDirectParamV6()` should not return a TS `encoder` closure in the port
  contract. Return serializable params and let the resolved direct boundary
  encode the final Augustus V6 calldata.
- The existing `ResolvedBuildInputObserver` remains useful for validating that
  orchestration still creates the same `BuildInput` / `DirectBuildInput` after
  port routing is introduced.
- DEX encoder conformance fixture schema versions should be documented next to
  the resolved-build fixture schema version. They do not need to share the same
  numeric value, but Go consumers must be able to reason about compatibility
  between both fixture families.
- WETH deposit/withdraw calldata is a separate provider port. Future Go code
  should implement it with native ABI encoding rather than importing a DEX
  encoder implementation.

## Review Concerns

Resolved during plan validation:

- The port's returned `DexExchangeParam.needWrapNative` is boolean-only.
  Function-typed results are resolved inside the TS adapter or future Go DEX
  implementation.
- Direct-method classification stays port-independent. The direct registry
  rejects unsupported DEX/method pairs.
- `OptimalSwapExchange.data` is DEX-owned JSON passed through unchanged.
- The port surface is limited to `needWrapNative`, `getDexParam`, and
  `getDirectParamV6`.
- `fetchRemoteDexParam` / `newDexs` is excluded from the strategic port design
  and is removed from `GenericSwapTransactionBuilder` in Phase 0.
- `TxInfo.networkFee` is excluded from `DirectParamResult` because current V6
  direct build orchestration ignores it.
- Pure orchestration helper extraction moved before the port flip as Phase 1.
- Phase 5 explicitly targets `buildResolvedCalls`; Phase 6 explicitly targets
  `_buildDirect()`.
- Fixture loaders must validate both `input` and `expected`.
- WETH deposit/withdraw calldata is handled by a dedicated provider port.
- `DirectParamResult` does not carry `contractMethod`.
- DEX encoder conformance fixtures are captured before port-routed
  orchestration replaces direct DEX calls.
- Every phase has an explicit acceptance gate.
- `WethDepositWithdrawInput` is V6-only and does not carry a ParaSwap version
  field.
- `WethCallDataProviderPort` is constructed from per-network encoding context
  and uses `wrappedNativeTokenAddress` plus a `NULL_ADDRESS` withdraw callee.
- DEX encoder conformance fixtures include top-level `network` and `dexKey`;
  direct fixtures also include top-level `contractMethod`.
