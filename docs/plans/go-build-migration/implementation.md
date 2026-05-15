# Go Parity Implementation For `buildTransactionFromResolved`

## Summary

Start with a DEX-independent Go implementation of
`buildTransactionFromResolved` in this repo. The first deliverable is fixture
parity for resolved generic transaction encoding only, using the existing
TypeScript fixtures as the contract.

This v1 ships a parallel Go fixture-parity implementation. Runtime migration
that replaces or bypasses the TypeScript implementation is a follow-up plan.

## Parity Definition

For v1, Go parity means exact comparison against committed fixture JSON:

- `expectedParams` must match by deep equality after JSON unmarshaling.
- `expectedTx.from`, `expectedTx.to`, and `expectedTx.data` must match exactly
  as lowercase `0x` hex strings.
- `expectedTx.from` is an input-echo check against `input.userAddress`, not a
  derived encoding behavior.
- `expectedTx.value` must match exactly as a decimal string.
- Optional gas fields (`gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`) are
  part of parity when present and must match exactly as decimal strings.
- Negative fixtures must return an error whose string equals the committed
  `expectedError`.

## Phases

### 1. Go Module And Fixture Contract

- Add a root `go.mod` and keep Go code under `go/txbuilder/...`.
- Mirror the current TypeScript resolved-build fixture contract.
- Load committed JSON fixtures directly; do not duplicate fixture data.
- The Go fixture loader must ignore TypeScript-only metadata fields:
  `orchestration`, `boundaryOnly`, and `boundaryOnlyReason`.
- The Go fixture loader treats `coverage` as informational metadata; coverage
  tags do not gate fixture execution.
- Phase 2 fixture scope is generic success fixtures plus negative fixtures whose
  `input` has `routePlan`. Direct success and direct-only negative fixtures move
  to Phase 3.
- The Go fixture loader lives in `go/txbuilder/internal/testfixtures` and uses
  `filepath.WalkDir` to recursively load
  every `.json` file under
  `tests/generic-swap-transaction-builder/fixtures/resolved-build/`
  from the repository root discovered by walking upward to `go.mod`.
- New TypeScript fixtures are picked up automatically by the Go glob; no Go-side
  fixture registration list is allowed.
- Go tests must assert the scoped fixture names and count against the TypeScript
  fixture matrix so skipped files fail loudly. This baseline must come from a
  committed TypeScript-generated manifest, for example
  `tests/generic-swap-transaction-builder/fixtures/resolved-build-manifest.json`,
  listing scoped fixture paths and content hashes by bucket.
- `yarn fixtures:check` must regenerate and verify the manifest. Walked-only
  baselines and manually maintained Go fixture lists are not allowed.
- The fixture loader classifies each fixture into a scope bucket based on
  directory and whether `input.routePlan` is present. Each phase's tests filter
  from these buckets, and cross-bucket leakage fails the scoped count/name
  baseline test.
- Phase 1 ships with `go/txbuilder/internal/testfixtures` loader tests that load
  at least one known generic fixture, assert non-empty `coverage`, and assert
  the scoped fixture count/name baseline.
- TypeScript remains the authoritative schema validator. Go validates
  schema-version support and required fields needed to unmarshal and execute the
  scoped fixtures, but it does not duplicate the full Jest fixture schema.

### 2. Encoding Foundation

- Define `resolved.BuildDeps` with:
  - `EncodingContext.Network`
  - `EncodingContext.AugustusV6Address`
  - `EncodingContext.WrappedNativeTokenAddress`
  - `EncodingContext.ExecutorsAddresses`
  - parsed Augustus V6 ABI
- Export the default executor-address contract from TypeScript into a committed
  JSON file consumed by Go tests. `yarn fixtures:check` must fail if
  `tests/generic-swap-transaction-builder/fixtures/resolved-build-deps.ts` and
  that JSON diverge.
- Fixture tests construct `BuildDeps` from fixture input plus the committed
  executor-address JSON, with the WETH executor address set to
  `input.wrappedNativeTokenAddress`.
- Validate network, Augustus V6 address, wrapped native token address, executor
  type, and executor address consistency before encoding.
- Use `go-ethereum/accounts/abi` for ABI encoding, `common`/`hexutil` for
  address and hex handling, and `math/big` for fee packing and amount math.
- Treat `src/abi/augustus-v6/ABI.json` as the canonical Augustus V6 ABI.
  Embed a Go-local copy with `//go:embed` under `go/txbuilder/...` so Go tests
  and future runtime code do not depend on relative filesystem reads, and add a
  test that fails if the embedded copy diverges from the canonical TS ABI file.
- Add targeted unit parity tests for function selectors, generic swap tuple
  packing, UUID/block metadata packing, and partner-and-fee bit packing. Full
  end-to-end calldata parity belongs to Phase 2f.

The sub-phases below depend on Phase 2's primitives and are intended to land as
separate reviewable gates.

### 2a. Generic Input Types And Validation

- Implement Go `resolved.BuildTransactionFromResolved(input, deps)`.
- Validate `input` and `deps` before bytecode or ABI encoding, matching the
  TypeScript boundary call order.
- The canonical validation order is
  `src/generic-swap-transaction-builder/resolved/build-transaction.ts`,
  especially `validateBuildInput(...)`. Go ports must match function-call
  sequence, not only validation rule coverage.
- Match exact committed negative fixture `expectedError` strings for v1 parity.
  Introduce stable error codes or normalization only through a future fixture
  schema change.
- Validation errors must mirror the TypeScript `Error` message format
  token-for-token, including dynamic argument order, separators, pluralization,
  and address casing.
- Before Phase 2a sign-off, verify that in-scope negative fixtures collectively
  pin the first-failing validation rule order. Reordering Go validation checks
  must surface as an exact `expectedError` mismatch on at least one fixture.
- Cover generic methods:
  - `swapExactAmountIn`
  - `swapExactAmountOut`
  - `swapExactAmountInPro`
  - `swapExactAmountOutPro`
- Treat `swapExactAmountInPro` as sharing the same params shape and encoding
  path as `swapExactAmountIn`, and `swapExactAmountOutPro` as sharing the same
  params shape and encoding path as `swapExactAmountOut`.
- Pro-method coverage must prove selector and ABI method selection parity. The
  regular In/Out fixture matrix covers params, executor bytecode, fees, WETH,
  and transaction value behavior.

### 2b. Executor01 Parity

- Port the Executor01 bytecode path.
- Acceptance gate: Executor01 simple SELL and multiswap SELL fixtures match
  `expectedParams` and `expectedTx` exactly.

### 2c. Executor02 Parity

- Port the Executor02 bytecode path.
- Acceptance gate: Executor02 vertical-branch and megaswap SELL fixtures match
  `expectedParams` and `expectedTx` exactly.

### 2d. Executor03 Parity

- Port the Executor03 bytecode path.
- Preserve Executor03 reordering by `needWrapNative` while keeping original
  route position metadata.
- Acceptance gate: Executor03 BUY fixtures match `expectedParams` and
  `expectedTx` exactly.

### 2e. WETH And Cross-Cutting Generic Features

- Port WETH-only behavior, including the `0x` executor bytecode rule.
- Cover ETH/WETH deposit and withdraw handling.
- Cover `permit2Approval`, `transferSrcTokenBeforeSwap`,
  `sendEthButSupportsInsertFromAmount`, insertion-offset math, special-dex
  flags, packed amounts, fee variants, and `partnerAndFee`.
- Acceptance gate: all generic success fixtures match `expectedParams` and
  `expectedTx` exactly.

### 2f. Augustus V6 Calldata Parity

- Verify full calldata byte equality for all four generic methods:
  `swapExactAmountIn`, `swapExactAmountOut`, `swapExactAmountInPro`, and
  `swapExactAmountOutPro`.
- Do not add Executor01 or Executor02 BUY fixture requirements. Generic BUY
  routes are Executor03-only according to `ExecutorDetector`; additional
  `swapExactAmountOut` coverage should target supported Executor03 route shapes.
- Add at least one additional committed `swapExactAmountOut` fixture for a
  supported Executor03 route shape beyond the existing single BUY fixture before
  claiming robust exact-out coverage.
- Pro-method calldata parity may reuse representative In/Out inputs because Pro
  methods only change the Augustus selector. Do not create Go-only Pro golden
  vectors; if Pro params diverge in TypeScript later, add shared committed
  fixtures before extending Go parity.
- Add decoded assertion helpers so failures show both raw calldata diffs and
  decoded ABI argument diffs.

### 3. Direct Builder After Generic Parity

- Implement `resolved.BuildDirectTransactionFromResolved(input, deps)` only
  after generic parity is stable.
- Use existing direct fixtures as a separate acceptance surface.
- Run direct-only negative fixtures in Phase 3 and match exact committed
  `expectedError` strings.
- Phase 3 unlocks Go-side direct fixture parity only. Runtime use still requires
  Go-side direct DEX encoders, which are out of scope for this plan.
- Direct fixtures already carry DEX-specific encoded params in `input.params`.
  Phase 3 verifies that Go produces identical Augustus V6 calldata for those
  params; it does not encode DEX params in v1.

### 4. Runtime Bridge Out Of Scope

- Keep TypeScript `GenericSwapTransactionBuilder.build()` unchanged in this
  plan.
- Do not add a child process, native addon, WASM module, or service bridge in
  this plan.
- Plan the runtime bridge separately after generic and direct Go fixture parity
  pass.

## Tooling And Distribution

- Use module path `github.com/paraswap/paraswap-dex-lib`; Go packages live under
  import paths such as `github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved`.
- Pin the `go` directive in `go.mod` to the lowest supported version that can
  run the implementation; default to `go 1.22` unless implementation requires a
  newer standard-library feature.
- Keep Go code out of npm package contents unless a future runtime-bridge plan
  requires shipping Go artifacts; add `.npmignore` coverage if the package
  publish rules would otherwise include `go/`.
- Add `go test ./go/...` and `go vet ./go/...` as the Go CI gate once Phase 1
  lands.
- Require `gofmt -s` for all Go files. Do not add `golangci-lint` in this plan
  unless the repo adopts a Go lint baseline separately.

## Byte-Level Hazards

- Use `*big.Int` for `partnerAndFee`, bit masks, shifts, and amount math; never
  use fixed-width integers for 256-bit values.
- Avoid `common.Address.Hex()` for fixture output because it returns checksum
  casing. Serialize addresses as lowercase `0x` hex.
- Treat fixture calldata and transaction data as lowercase even-length `0x`
  hex strings.
- Keep ABI dynamic-type offset and padding behavior under explicit tests,
  especially for `bytes`, nested tuples, and arrays.
- Serialize `tx.value` and gas fields as decimal strings, matching fixture JSON.
- Keep UUID/block metadata packing byte-for-byte with the TypeScript
  `hexZeroPad(uuidToBytes16(uuid), 16) + hexZeroPad(blockNumber, 16)` behavior.

## Risks

- **ABI byte mismatch:** numeric padding, dynamic offsets, or tuple packing can
  produce valid but different calldata. Mitigate with decoded ABI diff helpers
  on every calldata assertion failure.
- **Executor state-machine drift:** each executor should land behind its own
  fixture gate instead of waiting for aggregate parity.
- **Fixture contract drift:** TypeScript remains the fixture generator and schema
  authority; Go fixture tests must fail on unsupported `schemaVersion`.
- **Runtime integration risk:** no production TypeScript call path changes in
  this plan, so rollback is simply not enabling a future bridge.

## Public Interfaces

- New Go API:
  - `resolved.BuildTransactionFromResolved(input, deps)`
  - later: `resolved.BuildDirectTransactionFromResolved(input, deps)`
- TypeScript public SDK and builder APIs remain unchanged during fixture-parity
  phases.
- Fixture schema stays version `1` unless the TypeScript contract changes first.

## Test-Only Interfaces

- New in-repo Go test helper:
  - `resolvedtest.BuildDepsFromFixtureInput(input)`
- Test-only helpers may live under `go/txbuilder/internal/...` and are not
  downstream public APIs.

## Test Plan

- `go test ./go/...`
- `go vet ./go/...`
- `yarn fixtures:check`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- Compare Go output against fixture `expectedParams`, `expectedTx`, and
  exact negative fixture `expectedError` strings.

## Assumptions

- First deliverable is resolved transaction encoding only.
- No planning, pricing, preprocessing, approval lookup, or DEX-specific
  `getDexParam` logic is included in the first deliverable.
- "All of them" means all existing resolved generic fixture behaviors in the
  committed fixture matrix.
- Runtime TypeScript-to-Go integration requires a separate plan.
