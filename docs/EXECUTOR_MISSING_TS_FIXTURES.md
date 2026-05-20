# Missing Executor TS Parity Fixtures

**Status:** partially implemented.

Implemented in this repo:

- `src/executor/executor-missing-fixtures-snapshot.test.ts` records fixed
  TypeScript reference bytecode for:
  - Executor01 `returnAmountPos`, `insertFromAmountPos`,
    `sendEthButSupportsInsertFromAmount`,
    `swappedAmountNotPresentInExchangeData`, and
    `specialDexSupportsInsertFromAmount` cases.
  - Executor02 `returnAmountPos`, root-unwrap return-position fallback, and
    `insertFromAmountPos` cases.
  - Executor03 `insertFromAmountPos`, `amountsPacked128`, and negative
    `uint256` amount-position fallback cases.
  - Explicit `insertFromAmountPos=65535` and
    `insertFromAmountPos`-ignored-when-the-flag-does-not-insert cases for
    Executor01, Executor02, and Executor03.
- `src/executor/__snapshots__/executor-missing-fixtures-snapshot.test.ts.snap`
  is the TypeScript bytecode source of truth for those cases.
- The same snapshot file now also records in-repo TypeScript bytecode for:
  - the emitted non-default `specialDexFlag` inventory currently found in
    `src/dex`;
  - Executor02/03 ERC20, Permit2, and disabled-token-reset approval paths;
  - Executor02/03 WETH approval plus deposit paths;
  - Executor02/03 `transferSrcTokenBeforeSwap` paths;
  - Executor02/03 unwrap and custom-WETH paths.
  - RA-6 Base `tessera -> metric` route using the real TypeScript Tessera and
    Metric encoders, with Metric `returnAmountPos=0`.

Still open:

- Wire these TS snapshots into Go full-bytecode equality tests when the
  corresponding Go scope guards are intentionally relaxed. The current Go
  builders still reject several of these branches by design.

This file tracks executor behavior that is implemented or planned in Go but still needs fixed TypeScript reference bytecode. The goal is to avoid treating substring or metadata-only Go tests as full parity for sequencing-sensitive calldata.

Reference TypeScript repo:

- `/Users/danylokaniev/work/paraswap/paraswap-dex-lib`

Known TS fixture pattern:

- Existing Executor02 snapshot harness:
  - `src/executor/executor02-bytecode-builder-snapshot.test.ts`
  - fixtures under `src/executor/fixtures/executor02/...`
  - snapshots under `src/executor/__snapshots__/executor02-bytecode-builder-snapshot.test.ts.snap`
- No Executor03 snapshot harness was found in `src/executor` at the time this doc was written. Add one or create a small fixture generator before recording Executor03 reference bytecode.

Recommended workflow for each fixture:

1. Add JSON fixtures in the TS repo for `priceRoute`, `exchangeParams`, and optional `maybeWethCallData`.
2. Record the TS output as a Jest snapshot or as an explicit hex fixture.
3. Mirror the same inputs in Go.
4. Add a Go test that asserts full bytecode equality against the recorded TS hex, not selector or substring ordering.
5. Run the relevant TS snapshot/e2e command and `go test ./...`.

---

## Priority Summary

**Must-have parity fixtures:**

- Executor01 validation-only flag behavior from
  `docs/EXECUTOR_VALIDATION_ONLY_GATES_PLAN.md`: TS snapshots added; Go
  full-bytecode parity remains blocked by current scope guards.
- Executor01/02 `returnAmountPos`: TS snapshots added, including Executor02
  root-unwrap fallback; Go full-bytecode parity remains blocked by current
  scope guards.
- Executor01/02/03 `insertFromAmountPos`: TS snapshots added, including ignored
  insert-position and max `65535` cases; Go full-bytecode parity remains
  blocked by current scope guards.
- Feature 2 WETH approval + deposit for Executor02/03: TS snapshots added; Go
  full-bytecode parity remains blocked by current scope guards.
- Feature 3 transfer-before-swap sequencing for Executor02/03: TS snapshots
  added; Go full-bytecode parity remains blocked by current scope guards.
- Feature 4 unwrap/custom-WETH shapes before implementation: TS snapshots
  added; Go full-bytecode parity remains blocked by current scope guards.

**Useful hardening fixtures:**

- Executor03 `amountsPacked128`: TS snapshots added; Go full-bytecode parity
  remains blocked by current scope guards.
- Normal Executor02/03 approval paths without WETH wrapping: TS snapshots added;
  Go full-bytecode parity remains blocked by current scope guards.

---

## Return Amount Position

### RA-1: Executor01 `returnAmountPos=0`

**Why needed:** locks the one-byte return-position override for the Metric-style case that originally exposed the gap.

**Current Go coverage:** `txbuilder/executor/return_amount_pos_test.go` inspects packed metadata bytes and `BuildBytecode` success.

**TS fixture target:**

- Add or identify an Executor01 snapshot harness in `src/executor`.
- Fixture folder: `src/executor/fixtures/executor01/...`
- Route shape:
  - SELL route.
  - Executor01 route ownership.
  - `returnAmountPos=0`.
  - DEX calldata with normal `fromAmount` insertion.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### RA-2: Executor01 Non-Zero `returnAmountPos`

**Why needed:** proves the override is packed as a caller-provided value, not just defaulted to zero.

**TS fixture target:**

- Add or identify an Executor01 snapshot harness in `src/executor`.
- Route shape:
  - same as RA-1, but `returnAmountPos` is a non-zero valid byte value, for example `7`.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### RA-3: Executor02 `returnAmountPos=0`

**Why needed:** Executor02 shares the one-byte return-position metadata shape with Executor01 but has different route/metadata wrappers.

**TS fixture target:** added in
`src/executor/executor-missing-fixtures-snapshot.test.ts`.

Historical target:

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - SELL route that selects Executor02.
  - `returnAmountPos=0`.
  - no unwrap fallback branch.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### RA-4: Executor02 Non-Zero `returnAmountPos`

**Why needed:** mirrors RA-2 for Executor02 metadata.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - same as RA-3, but `returnAmountPos` is a non-zero valid byte value, for example `7`.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### RA-5: Executor02 Unwrap Fallback Ignores `returnAmountPos`

**Why needed:** TS intentionally falls back to `defaultReturnAmountPos` for root/native unwrap or unwrap-after-last-swap cases.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shapes:
  - root/native unwrap path.
  - mixed last-swap unwrap path.
  - `returnAmountPos` set to a non-default value so fallback is visible.

**Go parity target:** full bytecode equality and packed byte assertions in `txbuilder/executor/return_amount_pos_test.go`.

### RA-6: Downstream Metric Route E2E

**Why needed:** catches the real integration route that originally failed before the local Executor01/02 implementation.

**TS reference status:** added in
`src/executor/executor-missing-fixtures-snapshot.test.ts` using the provided
Base route, the real TypeScript `Tessera` and `Metric` encoders, and a fixed
test-local deadline for stable Metric calldata.

**Route:**

- network `8453`.
- SELL, `swapExactAmountIn`.
- `tessera` then `metric`.
- Metric encoder returns `returnAmountPos=0`.

**Go parity target:** full bytecode equality once the corresponding Go Metric
encoder/route is available in this repo or in the downstream integration suite.

---

## Insert From Amount Position

### IFAP-1: Executor01 Explicit `insertFromAmountPos`

**Why needed:** locks explicit 2-byte `fromAmountPos` override behavior for Executor01.

**Current Go coverage:** `txbuilder/executor/return_amount_pos_test.go`.

**TS fixture target:**

- Add or identify an Executor01 snapshot harness in `src/executor`.
- Fixture folder: `src/executor/fixtures/executor01/...`
- Route shape:
  - Executor01 route ownership.
  - `insertFromAmountPos` set to a visible non-zero value, for example `68`.
  - flag inserts amount.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### IFAP-2: Executor02 Explicit `insertFromAmountPos`

**Why needed:** locks explicit 2-byte `fromAmountPos` override behavior for Executor02.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - Executor02 route ownership.
  - `insertFromAmountPos=68`.
  - flag inserts amount.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### IFAP-3: Executor03 Explicit `insertFromAmountPos`

**Why needed:** Executor03 also packs a 2-byte `fromAmountPos`, while `toAmountPos` must continue to be derived from destination amount.

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape:
  - Executor03 route ownership.
  - `insertFromAmountPos=68`.
  - flag inserts amount.
  - destination amount appears in calldata so `toAmountPos` is deterministic.

**Go parity target:** full bytecode equality in `txbuilder/executor/return_amount_pos_test.go`.

### IFAP-4: `insertFromAmountPos` Ignored When Flag Does Not Insert

**Why needed:** TS ignores the override when the selected flag does not insert from-amount.

**TS fixture target:** added in
`src/executor/executor-missing-fixtures-snapshot.test.ts`.

Historical target:

- Executor01, Executor02, and Executor03 fixtures or generator cases.
- Route shape:
  - `insertFromAmountPos` set.
  - selected flag prevents amount insertion, for example via `swappedAmountNotPresentInExchangeData=true`.

**Go parity target:** full bytecode equality plus packed `fromAmountPos=0` assertions in `txbuilder/executor/return_amount_pos_test.go`.

### IFAP-5: Maximum Valid `insertFromAmountPos=65535`

**Why needed:** the Go validator allows the full 2-byte range. A fixture at the upper bound locks packing behavior.

**TS fixture target:** added in
`src/executor/executor-missing-fixtures-snapshot.test.ts`.

Historical target:

- Executor01, Executor02, and Executor03 fixtures or generator cases.
- Route shape:
  - `insertFromAmountPos=65535`.
  - flag inserts amount.

**Go parity target:** full bytecode equality or explicit packed byte equality in `txbuilder/executor/return_amount_pos_test.go`.

---

## Validation-Only Flag Gates

These cases are implemented in Go with metadata tests but still need TypeScript bytecode fixtures for full parity confidence.

### VOG-1: Executor01 `sendEthButSupportsInsertFromAmount=true`

**Why needed:** changes ETH send flag from send-only to send-plus-insert.

**Current Go coverage:** `txbuilder/executor/validation_only_gates_test.go`.

**TS fixture target:**

- Add or identify an Executor01 snapshot harness in `src/executor`.
- Fixture folder: `src/executor/fixtures/executor01/...`
- Route shape:
  - native source token.
  - `sendEthButSupportsInsertFromAmount=true`.
  - DEX calldata contains source amount so insertion position is visible.

**Go parity target:** full bytecode equality in `txbuilder/executor/validation_only_gates_test.go`.

### VOG-2: Executor01 `swappedAmountNotPresentInExchangeData=true`

**Why needed:** prevents from-amount insertion and changes flag/position behavior.

**Current Go coverage:** `txbuilder/executor/validation_only_gates_test.go`.

**TS fixture target:**

- Add or identify an Executor01 snapshot harness in `src/executor`.
- Fixture folder: `src/executor/fixtures/executor01/...`
- Route shape:
  - ERC20 source token.
  - `swappedAmountNotPresentInExchangeData=true`.
  - source amount may be absent from calldata.

**Go parity target:** full bytecode equality in `txbuilder/executor/validation_only_gates_test.go`.

### VOG-3: Executor01 `specialDexSupportsInsertFromAmount`

**Why needed:** non-default special DEX flags interact with amount insertion support.

**Current Go coverage:** `txbuilder/executor/validation_only_gates_test.go`.

**TS fixture target:**

- Add or identify an Executor01 snapshot harness in `src/executor`.
- Fixture folder: `src/executor/fixtures/executor01/...`
- Route shapes:
  - non-default `specialDexFlag` with `specialDexSupportsInsertFromAmount=true`.
  - non-default `specialDexFlag` with `specialDexSupportsInsertFromAmount=false`.

**Go parity target:** full bytecode equality in `txbuilder/executor/validation_only_gates_test.go`.

### VOG-4: Emitted Non-Default `specialDexFlag` Inventory

**Why needed:** special flags are contract-semantic, not just metadata bytes.

**Current Go coverage:** `txbuilder/executor/validation_only_gates_test.go` covers representative allowed and rejected flags.

**TS reference status:** added in
`src/executor/executor-missing-fixtures-snapshot.test.ts` for the non-default
flags currently emitted from `src/dex`. Internal executor-only flags remain
documented but are not treated as DEX-emitted inventory.

**TS fixture target:**

- Inventory actively emitted flags:
  - `rg -n "specialDexFlag|SpecialDex\\." /Users/danylokaniev/work/paraswap/paraswap-dex-lib/src/dex`
  - `rg -n "SpecialDexFlag|specialDexFlag" .`
- Add one TS bytecode fixture per emitted flag/executor pair.
- Keep internal-only flags without fixtures and gated:
  - `specialDexSendNative`
  - `specialDexExecuteVerticalBranching`

**Go parity target:** full bytecode equality per emitted flag/executor pair in `txbuilder/executor/validation_only_gates_test.go`.

---

## Amounts Packed 128

### AP128-1: Executor03 Positive Packed Int128

**Why needed:** metadata tests are acceptable by plan, but TS equality would lock the subtle byte-aligned packed search and bit-15 flag behavior.

**Current Go coverage:** `txbuilder/executor/executor03_amounts_packed128_test.go`.

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape:
  - Executor03 route ownership.
  - `amountsPacked128=true`.
  - positive source and destination amounts are present as packed 16-byte int128 values.

**Go parity target:** full bytecode equality in `txbuilder/executor/executor03_amounts_packed128_test.go`.

### AP128-2: Executor03 Negative Packed Int128

**Why needed:** TS searches negative two's-complement int128 if positive is not found.

**Current Go coverage:** `txbuilder/executor/executor03_amounts_packed128_test.go`.

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape:
  - Executor03 route ownership.
  - `amountsPacked128=true`.
  - negative two's-complement packed source and destination amounts in calldata.

**Go parity target:** full bytecode equality in `txbuilder/executor/executor03_amounts_packed128_test.go`.

---

## Normal Executor02/03 Approval Paths

These are lower priority than WETH-approval fixtures because the current plan accepts metadata/prefix tests for normal approval paths. Add them for broader TS parity coverage.

**TS reference status:** APPR-1 through APPR-6 are recorded in
`src/executor/executor-missing-fixtures-snapshot.test.ts`.

### APPR-1: Executor02 ERC20 Max Approval

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - ERC20 source token.
  - `approveData` present.
  - `permit2Approval=false`.
  - `skipApproval=false`.
  - `transferSrcTokenBeforeSwap` absent.

### APPR-2: Executor02 Permit2 Approval

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - same as APPR-1.
  - `permit2Approval=true`.

### APPR-3: Executor02 Disabled Max-Unit Reset

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - source token is a disabled max-unit approval token for the selected network.
  - normal ERC20 approval path.
  - expected output includes reset-to-zero approval before max approval.

### APPR-4: Executor03 ERC20 Max Approval

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape mirrors APPR-1 with Executor03 route ownership.

### APPR-5: Executor03 Permit2 Approval

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape mirrors APPR-2 with Executor03 route ownership.

### APPR-6: Executor03 Disabled Max-Unit Reset

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape mirrors APPR-3 with Executor03 route ownership.

**Go parity target for APPR-1 through APPR-6:** full bytecode equality in `txbuilder/executor/executor0203_approval_test.go`.

---

## Feature 2: Approval + WETH Wrapping

**TS reference status:** F2-1 and F2-2 are recorded in
`src/executor/executor-missing-fixtures-snapshot.test.ts`.

### F2-1: Executor02 WETH Deposit Approval

**Why needed:** the plan allows metadata/prefix checks for normal approval paths, but requires TS equality when approval is combined with WETH wrapping.

**Current Go coverage:** `TestExecutor0203WETHDepositApprovalCalldata` checks that approval appears before WETH deposit, but not full bytecode equality.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - native source token.
  - `needWrapNative=true`.
  - `approveData` present for wrapped native token.
  - `skipApproval=false`.
  - `transferSrcTokenBeforeSwap` absent.
  - non-root deposit shape if needed to avoid unrelated root-wrapper behavior.

**Go parity target:** add full bytecode equality for the same route in `txbuilder/executor/executor0203_approval_test.go`.

### F2-2: Executor03 WETH Deposit Approval

**Why needed:** Executor03 uses different calldata metadata, so prefix/order checks are insufficient for WETH approval + deposit.

**Current Go coverage:** `TestExecutor0203WETHDepositApprovalCalldata` checks ordering only.

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape:
  - native source token.
  - `needWrapNative=true`.
  - `approveData` present for wrapped native token.
  - `skipApproval=false`.
  - `transferSrcTokenBeforeSwap` absent.

**Go parity target:** add full bytecode equality for the same route in `txbuilder/executor/executor0203_approval_test.go`.

---

## Feature 3: `transferSrcTokenBeforeSwap`

**TS reference status:** F3-1 through F3-5 are recorded in
`src/executor/executor-missing-fixtures-snapshot.test.ts`.

### F3-1: Executor02 Single-Swap Transfer Before Swap

**Why needed:** current Go tests assert full wrapped transfer calldata appears, but do not compare full bytecode against TS.

**Current Go coverage:** `TestExecutor0203TransferBeforeSwapSuppressesApproval`.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - one route, one swap, one swap exchange.
  - ERC20 source token.
  - `transferSrcTokenBeforeSwap` set.
  - `approveData` optionally present to prove transfer suppresses approval.
  - `skipApproval=false`.

**Go parity target:** add full bytecode equality in `txbuilder/executor/executor0203_transfer_test.go`.

### F3-2: Executor02 Split Swap Transfer Before Swap

**Why needed:** split-within-one-swap sequencing differs from sequential multi-swap sequencing.

**Current Go coverage:** `TestExecutor0203TransferBeforeSwapSplitSwapSequencing` covers full wrapped transfer insertion and ordering, but not TS equality.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - one route, one swap, two swap exchanges.
  - `transferSrcTokenBeforeSwap` set on the second exchange.
  - distinct selectors/calldata per exchange so ordering is unambiguous.

**Go parity target:** full bytecode equality for split-swap route in `txbuilder/executor/executor0203_transfer_test.go`.

### F3-3: Executor02 Sequential Multi-Swap Transfer Before Swap

**Why needed:** Go currently covers sequential multi-swap ordering; the TS
snapshot now locks the full reference bytecode for the same branch.

**Current Go coverage:** `TestExecutor02TransferBeforeSwapMultiSwapSequencing`.

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Fixture folder: `src/executor/fixtures/executor02/...`
- Route shape:
  - one route, two swaps.
  - one exchange per swap.
  - `transferSrcTokenBeforeSwap` set on the second swap's exchange.
  - ERC20 intermediate source token for the second swap.

**Go parity target:** full bytecode equality for sequential multi-swap route in `txbuilder/executor/executor0203_transfer_test.go`.

### F3-4: Executor03 Single-Swap Transfer Before Swap

**Why needed:** Executor03 uses Executor03 metadata, and current BuildBytecode integration validates the wrapped transfer bytes but not the entire bytecode.

**Current Go coverage:**

- `TestExecutor0203TransferBeforeSwapSuppressesApproval`.
- `TestExecutor03BuildBytecodeTransferUsesExecutor03Metadata`.

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape:
  - one route, one swap, one swap exchange.
  - ERC20 source token.
  - `transferSrcTokenBeforeSwap` set.
  - `approveData` optionally present to prove transfer suppresses approval.

**Go parity target:** full bytecode equality for Executor03 single-swap route in `txbuilder/executor/executor0203_transfer_test.go`.

### F3-5: Executor03 Split Swap Transfer Before Swap

**Why needed:** Executor03 orders split exchanges and uses `swap.swapExchanges[0].srcAmount` for transfer amount, matching TS behavior. That should be locked by TS bytecode equality.

**Current Go coverage:** `TestExecutor0203TransferBeforeSwapSplitSwapSequencing` covers the current Go behavior, including Executor03's first-swap-exchange transfer amount.

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shape:
  - one route, one swap, two swap exchanges.
  - `transferSrcTokenBeforeSwap` set on the second exchange.
  - distinct selectors/calldata per exchange.
  - distinct first and second source amounts so the TS first-exchange amount behavior is visible.

**Go parity target:** full bytecode equality for Executor03 split-swap route in `txbuilder/executor/executor0203_transfer_test.go`.

---

## Feature 4: `needUnwrapNative` And Custom `wethAddress`

Feature 4 is not implemented yet on the Go side and should stay fixture-first.
TypeScript reference bytecode is recorded in
`src/executor/executor-missing-fixtures-snapshot.test.ts`; use those snapshots
before relaxing any remaining unwrap/custom-WETH Go guards.

### F4-1: Executor02 WETH Source Unwrap Before DEX Call

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Route shape:
  - source token is canonical WETH.
  - `needUnwrapNative=true`.
  - DEX operates on native ETH.
  - no custom `wethAddress`.

### F4-2: Executor02 WETH Destination Wrap/Deposit

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Route shape:
  - destination token is canonical WETH.
  - `needUnwrapNative=true`.
  - DEX returns native ETH.
  - no custom `wethAddress`.

### F4-3: Executor02 Root/Native Unwrap

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Route shape:
  - final route destination is native ETH.
  - at least one last-swap exchange has `needWrapNative=true`.
  - include `returnAmountPos` override to verify fallback suppression.

### F4-4: Executor02 Mixed `NeedWrapNative` Last Swap

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Route shape:
  - one swap with at least two exchanges.
  - one exchange has `needWrapNative=true`; one has `needWrapNative=false`.
  - destination is native ETH.
  - verifies unwrap-after-last-swap behavior.

### F4-5: Executor02 Custom `wethAddress`

**TS fixture target:**

- Harness: `src/executor/executor02-bytecode-builder-snapshot.test.ts`
- Route shape:
  - same as the normal WETH path already covered, but with non-canonical `wethAddress`.
  - recorded after F4-1 through F4-4 to keep the custom-WETH reference isolated.

### F4-6: Executor03 WETH Source/Destination Wrap/Unwrap

**TS fixture target:**

- Add an Executor03 snapshot harness or generator in `src/executor`.
- Route shapes:
  - WETH source unwrap before DEX call.
  - WETH destination wrap/deposit after DEX call.
  - no root/native unwrap and no custom `wethAddress` until explicit TS fixture coverage exists.

---

## Out Of Scope For Fixtures

- Executor03 `returnAmountPos`; intentionally not planned.
- Executor01/02 `amountsPacked128`; TS support is Executor03-only.
- Executor02 BUY routes and Executor03 SELL/non-BUY routes unless TS `ExecutorDetector` changes.
- Executor03 root/native unwrap and custom `wethAddress` until TS fixture coverage proves contract-compatible behavior.
