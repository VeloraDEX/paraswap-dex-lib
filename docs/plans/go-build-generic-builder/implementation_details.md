# Go Public Generic Builder: Implementation Details

This document breaks
`docs/plans/go-build-generic-builder/implementation.md` into concrete
implementation work. The first section is scoped to Phase 1 plus the interface
foundations Phase 2 will depend on.

## Phase 1: Public Contract And Fixture Foundation

### Goal

Create the public Go builder contract, portable dependency interfaces, and
TypeScript-generated fixture surface without implementing public build
orchestration.

Phase 1 should make the next implementation slice straightforward: Phase 2 can
start wiring orchestration without revisiting DTO shape, fixture layout, or
port boundaries.

### Current State

- Go resolved generic encoding already exists under `go/txbuilder/resolved`.
- Go executor bytecode builders already exist under `go/txbuilder/executor`.
- Direct resolved encoding exists but is out of scope for this public generic
  builder plan.
- Existing resolved-build fixtures live under
  `tests/generic-swap-transaction-builder/fixtures/resolved-build/`.
- Existing DEX-encoder fixtures live under
  `tests/generic-swap-transaction-builder/dex-encoder/fixtures/`.
- `tmp/DEX-PARAM-API.md` documents the current HTTP single-leg DEX param
  contract, but Phase 1 should keep the Go builder core interface-driven.

### Execution Rule

Do not implement `BuildGeneric` orchestration in Phase 1. Avoid adding a public
stub that returns placeholder output; a callable stub can hide incomplete
behavior. Phase 1 may define the function signature in comments or tests, but
the real function should land with Phase 2 orchestration.

Do not implement Tessera, HTTP DEX-param adapters, approval lookup behavior,
WETH planning, route planning, executor detection, or direct public builder
logic in Phase 1.

### File Layout

Add or reserve these paths:

| Path                                                                                     | Purpose                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `go/txbuilder/builder/types.go`                                                          | Public `BuildRequest`, `PriceRoute`, `Deps`, options, and port interfaces. |
| `go/txbuilder/builder/types_test.go`                                                     | Phase 1 compile/shape tests and default zero-value checks where useful.    |
| `go/txbuilder/internal/publicbuildertest/fixtures.go`                                    | Test-only loader for public-builder fixtures.                              |
| `go/txbuilder/internal/publicbuildertest/fixtures_test.go`                               | Fixture loader and schema-version tests.                                   |
| `tests/generic-swap-transaction-builder/fixtures/go-public-builder/`                     | Generated public-builder fixtures.                                         |
| `tests/generic-swap-transaction-builder/fixtures/go-public-builder-schema.ts`            | TypeScript fixture schema and canonical stringify checks.                  |
| `tests/generic-swap-transaction-builder/fixtures/generate-go-public-builder-fixtures.ts` | Fixture generator entry point.                                             |

Do not add a runtime HTTP adapter package in Phase 1. If test helpers need a
fake DEX registry later, keep it under `go/txbuilder/internal/...`.

### Public Types

Define `BuildRequest` in `go/txbuilder/builder`:

```go
type BuildRequest struct {
	PriceRoute           PriceRoute
	MinMaxAmount         resolved.DecimalString
	QuotedAmount         *resolved.DecimalString
	UserAddress          resolved.Address
	ReferrerAddress      *resolved.Address
	PartnerAddress       resolved.Address
	PartnerFeePercent    resolved.DecimalString
	TakeSurplus          bool
	IsCapSurplus         *bool
	IsSurplusToUser      bool
	IsDirectFeeTransfer  bool
	GasPrice             *resolved.DecimalString
	MaxFeePerGas         *resolved.DecimalString
	MaxPriorityFeePerGas *resolved.DecimalString
	Permit               *resolved.HexBytes
	Deadline             resolved.DecimalString
	UUID                 string
	Beneficiary          *resolved.Address
}
```

Rules:

- `Deadline` is required for TypeScript public API compatibility, even though
  generic V6 encoding does not use it.
- `QuotedAmount`, `Permit`, and gas pointers preserve "unset vs explicitly
  empty" at the public boundary. Phase 2 will apply TypeScript truthiness:
  nil or empty quoted amount/permit means default.
- `IsCapSurplus` is a pointer because TypeScript defaults only when the value
  is omitted; Phase 2 will default nil to `true`.

Define `PriceRoute` in the same package:

```go
type PriceRoute struct {
	Network        int
	BlockNumber    int64
	ContractMethod string
	Side           resolved.Side
	SrcToken       resolved.Address
	DestToken      resolved.Address
	SrcAmount      resolved.DecimalString
	DestAmount     resolved.DecimalString
	BestRoute      []PriceRouteRoute
}

type PriceRouteRoute struct {
	Percent float64
	Swaps   []PriceRouteSwap
}

type PriceRouteSwap struct {
	SrcToken      resolved.Address
	DestToken     resolved.Address
	SrcAmount     *resolved.DecimalString
	DestAmount    *resolved.DecimalString
	SwapExchanges []PriceRouteSwapExchange
}

type PriceRouteSwapExchange struct {
	Exchange   string
	Percent    float64
	SrcAmount  resolved.DecimalString
	DestAmount resolved.DecimalString
	Data       json.RawMessage
}
```

Rules:

- `PriceRoute` is the public input DTO. It is not `resolved.RoutePlan`.
- `Swap.SrcAmount` and `Swap.DestAmount` are optional so Phase 2 can preserve
  TypeScript `buildRoutePlan` behavior: missing swap amounts are summed from
  swap exchanges.
- `SwapExchange.Data` is DEX-owned JSON and must remain opaque to the builder.

### Dependency And Port Types

Define:

```go
type Deps struct {
	EncodingContext resolved.EncodingContext
	AugustusV6ABI   *ethabi.ABI
	ExecutorFactory resolved.ExecutorBytecodeBuilderFactory
	DexRegistry     DexRegistry
	ApprovalChecker ApprovalChecker
	WethProvider    WethCallDataProvider
	Options         Options
}

type Options struct {
	SkipApprovalCheck bool
}
```

Rules:

- `SkipApprovalCheck` belongs in `Options`, matching TypeScript's constructor
  option. It is not a public per-build request field.
- If `SkipApprovalCheck` is true, Phase 2 must not require or call
  `ApprovalChecker`.
- If `SkipApprovalCheck` is false, Phase 2 may allow nil `ApprovalChecker`
  only when no approval requests are produced.

Define DEX ports:

```go
type DexRegistry interface {
	GetDexEncoder(ctx context.Context, network int, dexKey string) (DexEncoder, error)
}

type DexEncoder interface {
	NeedWrapNative(ctx context.Context, input NeedWrapNativeInput) (bool, error)
	GetDexParam(ctx context.Context, input DexParamInput) (DexExchangeParam, error)
}
```

Define approval and WETH ports:

```go
type ApprovalRequest struct {
	RoutePositionKey string
	Token            resolved.Address
	Target           resolved.Address
	Permit2          bool
}

type ApprovalChecker interface {
	Check(ctx context.Context, spender resolved.Address, requests []ApprovalRequest) ([]bool, error)
}

type WethCallDataInput struct {
	SrcAmountWeth resolved.DecimalString
	DestAmountWeth resolved.DecimalString
	Side resolved.Side
}

type WethCallDataProvider interface {
	GetDepositWithdrawCallData(ctx context.Context, input WethCallDataInput) (*resolved.WethPlan, error)
}
```

Rules:

- These are core interfaces. HTTP DEX-param integration may later implement
  `DexEncoder`, but the builder must not depend on HTTP types.
- `ApprovalRequest.RoutePositionKey` is intentionally part of the public
  checker port. Production checkers may ignore it, but adapters and tests can
  use it to log, debug, and validate decisions against the route-walk leg that
  produced the request.
- `WethCallDataProvider` returns the same shape the resolved encoder already
  consumes. Phase 2 will add the default provider.

### DEX DTO Contracts

Define `NeedWrapNativeInput` with route/swap/swap-exchange context matching the
TypeScript audited port contract:

```go
type NeedWrapNativeInput struct {
	Route        NeedWrapNativeRouteContext
	Swap         NeedWrapNativeSwapContext
	SwapExchange NeedWrapNativeSwapExchangeContext
}
```

Context fields:

- route: network, side, route index, route percent, block number, global
  src/dest tokens, global src/dest amounts
- swap: swap index, src/dest tokens, summed src/dest amounts
- swap exchange: swap-exchange index, exchange name, percent, src/dest amounts,
  opaque data

Define `DexParamInput` as `NeedWrapNativeInput` plus the endpoint-compatible
single-leg fields:

- `dexKey`
- `srcToken`
- `destToken`
- `srcAmount`
- `destAmount`
- `recipient`
- `executorAddress`
- `side`
- opaque `data`

This intentionally uses the existing TypeScript port contract rather than the
smaller HTTP endpoint body. The HTTP adapter can serialize the endpoint subset;
in-process Go DEX encoders can use the full context.

Define builder-local `DexExchangeParam`:

```go
type DexExchangeParam struct {
	NeedWrapNative                        bool
	NeedUnwrapNative                      *bool
	SkipApproval                          *bool
	WethAddress                           *resolved.Address
	ExchangeData                          resolved.HexBytes
	TargetExchange                        resolved.Address
	DexFuncHasRecipient                   bool
	SpecialDexFlag                        *int
	TransferSrcTokenBeforeSwap            *resolved.Address
	Spender                               *resolved.Address
	SendEthButSupportsInsertFromAmount    *bool
	SpecialDexSupportsInsertFromAmount    *bool
	SwappedAmountNotPresentInExchangeData *bool
	ReturnAmountPos                       *int
	InsertFromAmountPos                   *int
	AmountsPacked128                      *bool
	Permit2Approval                       *bool
}
```

Rules:

- Do not return `resolved.DexExchangeBuildParam` from `DexEncoder`; its
  `RawBool` is a resolved-boundary validation detail.
- Phase 2 converts `DexExchangeParam` into `resolved.DexExchangeBuildParam`.
- Conversion must set `NeedWrapNative` to
  `resolved.RawBool{Value: value, Valid: true, Present: true}`.

### Public-Builder Fixture Contract

Add a TypeScript fixture schema for public-builder fixtures.

Recommended fixture shape:

```ts
type GoPublicBuilderFixture = {
  schemaVersion: 1;
  name: string;
  description: string;
  kind: 'generic-public';
  dexKeys: string[];
  input: {
    request: BuildRequestJson;
    options: {
      skipApprovalCheck: boolean;
    };
  };
  expectedResolvedInput: BuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
};
```

Rules:

- `schemaVersion` starts at `1`.
- Fixture names must be globally unique in the fixture directory.
- Fixture `name` must equal the JSON filename basename without extension; the
  TypeScript and Go loaders both enforce this.
- Fixture JSON must be canonical via the same stable stringify convention used
  by existing resolved-build fixtures.
- `input.options.skipApprovalCheck` is required, even when false, because
  Phase 2 depends on explicit option semantics.
- TypeScript remains the schema authority.
- Phase 1 fixtures may include only minimal generic-public examples needed to
  exercise loader/schema behavior. Tessera matrix fixtures land by Phase 4.
- Generated fixtures must be included in `yarn fixtures:check`.

### Loader Contract

Add a Go test-only loader under `go/txbuilder/internal/publicbuildertest`.

Loader responsibilities:

- Find repo root by walking up to `go.mod`, reusing existing repo-root helper
  if possible.
- Walk every `.json` file under
  `tests/generic-swap-transaction-builder/fixtures/go-public-builder/`.
- Reject unsupported `schemaVersion`.
- Load raw bytes for canonical hash/debug output.
- Parse only the fields Phase 1 tests need:
  - `schemaVersion`
  - `name`
  - `kind`
  - `input.request`
  - `input.options`
  - `expectedResolvedInput`
  - `expectedParams`
  - `expectedTx`
- Ignore future metadata fields unless the TypeScript schema says otherwise.

### Phase 1 Tests

Go tests:

- `go/txbuilder/builder` compiles with the exported types.
- `go/txbuilder/internal/publicbuildertest` loads at least one fixture.
- Every loaded fixture `input.request` decodes strictly into
  `builder.BuildRequest` and has key public-route fields populated.
- Loader rejects unsupported fixture schema versions.
- Loader rejects duplicate fixture names.
- Loader rejects unknown `kind` values.
- Loader rejects missing `input.options`, missing `skipApprovalCheck`, and
  fixture-name/file-basename mismatches.

TypeScript tests:

- fixture schema validates generated public-builder fixtures.
- canonical stringify test fails on non-canonical fixture bytes.
- schema tests reject malformed request addresses/amounts and malformed
  expected resolved/tx output envelopes.
- `yarn fixtures:check` regenerates public-builder fixtures and catches tracked
  diffs and untracked files.

### Acceptance Checklist

- `go/txbuilder/builder` package exists with public DTOs and interfaces.
- Public-builder fixture schema and generator exist.
- Public-builder fixture loader exists.
- `fixtures:check` includes the new fixture root.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.
- `yarn jest tests/generic-swap-transaction-builder/fixtures/go-public-builder-fixtures.test.ts --runInBand`
- `yarn fixtures:check`

### Handoff To Phase 2

Phase 2 may implement `BuildGeneric` using these locked contracts. If Phase 2
needs to change any public DTO or fixture field, update this section first so
the contract remains explicit.

Phase 2 must add or preserve at least one public-builder fixture whose
`priceRoute.bestRoute[*].swaps[*].srcAmount` and `destAmount` are omitted, so
the TypeScript-compatible "sum swap amounts from swap exchanges" path is tested
before public orchestration is considered complete.

## Phase 2: Generic Orchestration With Fixture-Backed DEX Params

### Goal

Implement the public Go `BuildGeneric` orchestration path and prove it against
TypeScript-generated public-builder fixtures while keeping real DEX encoders
out of scope.

Phase 2 should answer one question precisely: given a public `BuildRequest`,
can Go produce the same resolved `BuildInput`, `params`, and `txObject` as the
TypeScript public builder when the DEX param outputs are supplied from
committed fixtures?

### Current State

- Phase 1 committed the public DTOs and portable interfaces in
  `go/txbuilder/builder`.
- Phase 1 committed one public-builder fixture derived from
  `executor01-simple-sell-approved`.
- The resolved generic boundary already encodes all committed generic success
  fixtures through `resolved.BuildTransactionFromResolved`.
- The public-builder fixture loader currently parses request/options and
  output goldens only. Phase 2 may extend the fixture contract with
  orchestration-observation fields.
- Real DEX encoder ports, including Tessera, are still out of scope for this
  phase.

### Execution Rule

Implement `BuildGeneric`; do not add Tessera, HTTP DEX-param adapters, direct
public builder support, or new resolved executor behavior in Phase 2.

The DEX layer used by Phase 2 tests must be fixture-backed. It should verify the
Go builder's DEX input DTOs and return committed TypeScript DEX param outputs.
It must not encode DEX params itself.

### File Layout

Add or update these paths:

| Path                                                                                     | Purpose                                                                                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `go/txbuilder/builder/build.go`                                                          | Public `BuildGeneric` entry point.                                                                  |
| `go/txbuilder/builder/route_plan.go`                                                     | Public `PriceRoute` to `resolved.RoutePlan`, `walkRoutePlan`, and route-position helpers.           |
| `go/txbuilder/builder/executor_detector.go`                                              | Go port of route execution type and executor detection.                                             |
| `go/txbuilder/builder/orchestration.go`                                                  | Quoted amount, beneficiary, permit, DEX call-param, WETH-plan, and resolved-input assembly helpers. |
| `go/txbuilder/builder/approval.go`                                                       | Approval request construction and approval-decision application.                                    |
| `go/txbuilder/builder/weth_provider.go`                                                  | Default WETH deposit/withdraw calldata provider.                                                    |
| `go/txbuilder/builder/normalize.go`                                                      | Public-input and DEX-output address normalization helpers.                                          |
| `go/txbuilder/builder/build_test.go`                                                     | Public-builder fixture parity tests.                                                                |
| `go/txbuilder/builder/orchestration_test.go`                                             | Focused defaulting, route-plan, approval, and fence tests.                                          |
| `go/txbuilder/internal/publicbuildertest/dex_registry.go`                                | Fixture-backed `DexRegistry`, `DexEncoder`, and `ApprovalChecker` test helpers.                     |
| `tests/generic-swap-transaction-builder/fixtures/go-public-builder-schema.ts`            | Extend fixture schema for expected DEX calls and approval observations.                             |
| `tests/generic-swap-transaction-builder/fixtures/generate-go-public-builder-fixtures.ts` | Generate the Phase 2 public fixture matrix and observation fields.                                  |

Keep any fixture-only helpers under `go/txbuilder/internal/...`. Do not put
test-only registries into the public `builder` package API.

### Fixture Contract Extension

Extend `GoPublicBuilderFixture` with the observations Phase 2 needs:

```ts
type GoPublicBuilderFixture = {
  // Phase 1 fields...
  expectedDexCalls: ExpectedDexCall[];
  expectedApprovalRequests: ExpectedApprovalRequest[];
  approvalDecisions: boolean[];
};

type ExpectedDexCall = {
  routePositionKey: string; // "%d:%d:%d"
  dexKey: string;
  needWrapNativeInput: NeedWrapNativeInput;
  needWrapNative: boolean;
  dexParamInput: DexParamInput;
  dexParam: DexExchangeParam;
};

type ExpectedApprovalRequest = {
  routePositionKey: string;
  token: Address;
  target: Address;
  permit2: boolean;
};
```

Rules:

- `expectedDexCalls` is ordered by route-plan traversal order, not by DEX key.
- `routePositionKey` format is `%d:%d:%d`, matching the resolved boundary.
- `dexParam.needWrapNative` must equal `needWrapNative`; fixtures should fail
  generation if TypeScript produces a mismatch.
- `approvalDecisions.length` must equal `expectedApprovalRequests.length`.
- The schema should validate address casing, decimal strings, hex bytes, and
  route-position key format for these new fields.
- The Go loader may keep these fields as `json.RawMessage` plus typed helper
  methods, but tests must decode them into builder DTOs and compare exact
  values.

### Phase 2 Fixture Matrix

Generate public-builder fixtures from committed generic resolved fixtures. The
first Phase 2 matrix should include at least:

| Fixture                                      | Source                                           | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `executor01-simple-sell-approved`            | existing resolved fixture                        | baseline SELL path with approvals already present                        |
| `executor01-simple-sell-approval-missing`    | existing resolved fixture                        | approval insertion path                                                  |
| `executor01-simple-sell-no-swap-amounts`     | new public-builder variant derived from existing | public route omits swap-level amounts; Go must sum swap-exchange amounts |
| `executor01-simple-sell-empty-quoted-amount` | new public-builder variant derived from existing | empty public `quotedAmount` defaults to `priceRoute.destAmount`          |
| `edge-zero-quoted-amount`                    | existing resolved fixture                        | explicit `"0"` quoted amount pass-through                                |
| `edge-nonempty-permit`                       | existing resolved fixture                        | permit passthrough                                                       |
| `executor01-eth-weth-deposit`                | existing resolved fixture                        | WETH deposit planning                                                    |
| `executor01-weth-eth-withdraw`               | existing resolved fixture                        | WETH withdraw planning                                                   |
| `weth-only-eth-to-weth`                      | existing resolved fixture                        | WETH executor detection and `0x` executor bytecode                       |
| `executor02-multiswap-sell`                  | existing resolved fixture                        | Executor02 SELL detector path                                            |
| `executor02-vertical-branch-sell`            | existing resolved fixture                        | vertical-branch detector path                                            |
| `executor02-megaswap-sell`                   | existing resolved fixture                        | mega-swap detector path                                                  |
| `executor03-buy`                             | existing resolved fixture                        | BUY exact-out detector path                                              |

If implementation effort is comparable, prefer generating public-builder
fixtures for every committed generic success fixture. That gives Phase 2 broad
coverage without real DEX encoders. Direct fixtures remain out of scope.

The no-swap-amount fixture should be generated by taking the public request
from an existing fixture, deleting `priceRoute.bestRoute[*].swaps[*].srcAmount`
and `destAmount`, and keeping the same expected resolved input/output. This
locks the TypeScript `buildRoutePlan` amount-summing behavior; Go verifies the
sum by matching the same expected resolved input as the with-amounts variant.

The empty-quoted-amount fixture should be generated from
`executor01-simple-sell-approved` by setting public `quotedAmount` to `""` and
keeping the same expected resolved input/output. That source fixture's resolved
quoted amount already equals `priceRoute.destAmount`, so the fixture proves the
public defaulting path rather than explicit quoted-amount pass-through.

Fixture generation must run the TypeScript public builder with instrumentation
rather than hand-assembling observations. Use a recording `DexEncoderRegistry`
port and a recording approval-checker hook while replaying the existing TS
builder path. The recorded DEX inputs/outputs become `expectedDexCalls`, and
the recorded approval requests/decisions become `expectedApprovalRequests` and
`approvalDecisions`.

### BuildGeneric Flow

Implement `BuildGeneric` in this order:

1. Validate required deps that are needed before any external calls:
   `AugustusV6ABI`, `ExecutorFactory`, `DexRegistry`,
   `EncodingContext.Network`, `EncodingContext.AugustusV6Address`,
   `EncodingContext.WrappedNativeTokenAddress`, and
   `EncodingContext.ExecutorsAddresses`.
2. Normalize public request addresses to lowercase before route planning:
   price-route tokens, user, partner, referrer, beneficiary, Augustus V6,
   wrapped native, and executor addresses from deps.
3. Validate `side` is `SELL` or `BUY`; reject other values before route
   planning with `invalid side: %s`.
4. Reject unsupported contract methods before route planning or DEX lookup.
   The public generic builder supports only:
   - `swapExactAmountIn`
   - `swapExactAmountOut`
   - `swapExactAmountInPro`
   - `swapExactAmountOutPro`
     Any direct V6, V5, unknown, or otherwise non-generic method fails before DEX
     lookup with `unsupported generic contract method for resolved build: %s`.
5. Resolve public defaults:
   - quoted amount: nil or `""` -> SELL `priceRoute.destAmount`, BUY
     `priceRoute.srcAmount`
   - quoted amount: non-empty -> pass through unchanged
   - beneficiary: unset or equal to user -> null address
   - permit: nil or `""` -> `0x`
   - `IsCapSurplus`: nil -> true
   - gas: nil if every gas pointer is nil or points to `""`
   - deadline: accepted for TS public API compatibility and ignored
6. Build `resolved.RoutePlan` from public `PriceRoute`.
7. Detect executor type from the normalized public price route.
8. Resolve executor address from `deps.EncodingContext.ExecutorsAddresses`.
   This map is authoritative for every executor, including `ExecutorWETH`.
   The deps helper and runtime configuration must set
   `ExecutorsAddresses[ExecutorWETH]` to the wrapped-native token address,
   matching the resolved-build contract; `BuildGeneric` should not bypass the
   map with a separate WETH-address lookup.
9. Validate request/context consistency before DEX lookup:
   - `priceRoute.network` must equal `deps.EncodingContext.Network`; use the
     same error format as the resolved boundary:
     `network mismatch: input %d, context %d`
   - the assembled Augustus V6 address and wrapped-native address must come
     from `deps.EncodingContext`; if future adapters expose explicit request
     values, compare them before DEX lookup using the resolved-boundary error
     formats:
     `augustusV6Address mismatch: input %s, context %s` and
     `wrappedNativeTokenAddress mismatch: input %s, context %s`
   - the selected executor address must exist in
     `deps.EncodingContext.ExecutorsAddresses` and match the address used in
     the assembled input; use
     `executor address mismatch: input %s, builder %s` for mismatches
10. Apply current resolved fences before DEX lookup:

- Executor02 BUY / exact-out rejects with
  `Executor02 BUY routes are not implemented in Phase 2c`
- Executor03 non-BUY / non-exact-out rejects with
  `Executor03 non-BUY routes are not implemented in Phase 2d`

11. Walk the route plan in route order. For each leg:
    - build `NeedWrapNativeInput`
    - call `DexRegistry.GetDexEncoder(ctx, network, dexKey)`
    - call `NeedWrapNative`
    - build generic DEX call params
    - call `GetDexParam`
    - fail if returned `DexExchangeParam.NeedWrapNative` differs from the
      precomputed `NeedWrapNative` result
    - convert builder-local `DexExchangeParam` to
      `resolved.DexExchangeBuildParam`
    - append `resolved.ResolvedLeg`
12. Build the optional `resolved.WethPlan`.
13. Build approval requests and apply approval decisions.
14. Assemble `resolved.BuildInput`.
15. Construct `resolved.BuildDeps` from the corresponding `builder.Deps`
    fields: `EncodingContext`, `AugustusV6ABI`, and `ExecutorFactory`.
16. Call `resolved.BuildTransactionFromResolved`.
17. Return the resolved output unchanged.

This order is part of the contract. In particular, direct-method and executor
fence failures must happen before DEX registry calls, and approval checking
must happen after WETH-adjusted resolved legs are available.

### Route Plan Port

Port TypeScript `src/executor/route-plan.ts` behavior:

- `BuildRoutePlan(priceRoute PriceRoute) (resolved.RoutePlan, error)`
- `WalkRoutePlan(routePlan resolved.RoutePlan) []RoutePlanExchange`
- `RoutePositionKey(routeIndex, swapIndex, swapExchangeIndex int) string`

Rules:

- Lowercase swap src/dest tokens in the route plan.
- Preserve route and swap-exchange percentages as numbers.
- Copy swap-exchange `exchange`, `percent`, `srcAmount`, and `destAmount`.
- If `PriceRouteSwap.SrcAmount` is nil, sum
  `SwapExchanges[*].SrcAmount` with `big.Int`.
- If `PriceRouteSwap.DestAmount` is nil, sum
  `SwapExchanges[*].DestAmount` with `big.Int`.
- Preserve DEX-owned `Data` as opaque input for `NeedWrapNativeInput` and
  `DexParamInput`.
- Do not copy DEX-owned `Data` into `resolved.RoutePlan`.

### Executor Detection

Port TypeScript `ExecutorDetector` route-type rules:

| Route shape                                            | SELL executor | BUY executor |
| ------------------------------------------------------ | ------------- | ------------ |
| one route, 100%, one swap, one exchange                | Executor01    | Executor03   |
| one route, 100%, one swap, multiple exchanges          | Executor02    | Executor03   |
| one route, 100%, multiple swaps, all exchanges 100%    | Executor01    | unsupported  |
| one route, 100%, multiple swaps, any exchange not 100% | Executor02    | unsupported  |
| more than one route                                    | Executor02    | unsupported  |
| supported single native-source route on WETH exchange  | WETH          | unsupported  |

Rules:

- WETH single-wrap detection runs before generic route-shape detection.
- WETH single-wrap detection matches `WETHBytecodeBuilder.isSingleWrapRoute`:
  one route, one swap, one exchange, supported WETH exchange key, supported
  network, and native source token. It must not require destination token to be
  wrapped native, and it must not require route percent to be 100 because the
  TypeScript predicate does not check either field.
- Unsupported route types return `Route type is not supported yet` unless a
  more specific existing fence applies.
- Executor02 BUY and Executor03 non-BUY must be rejected before DEX lookup by
  the same strings used in `resolved.BuildTransactionFromResolved`.

### DEX Input Construction

Build `NeedWrapNativeInput` and `DexParamInput` from normalized public
route context.

`NeedWrapNativeInput` fields:

- route: network, side, route index, route percent, block number, public
  src/dest token, public src/dest amount
- swap: swap index, route-plan swap src/dest token, summed route-plan
  src/dest amount
- swap exchange: swap-exchange index, exchange key, percent, src/dest amount,
  opaque DEX data

`DexParamInput` adds:

- `DexKey`: swap-exchange exchange key
- `SrcToken`, `DestToken`, `DestAmount`, `Recipient` from generic DEX
  call-param resolution
- `SrcAmount` uses generic DEX call-param resolution for SELL; for BUY it must
  use the original `swapExchange.srcAmount`, matching
  `src/generic-swap-transaction-builder.ts`. This is intentionally different
  from the resolved leg's `NormalizedSrcAmount`.
- `ExecutorAddress`: selected executor address
- `Side`: public price-route side
- `Data`: same opaque data as `swapExchange.data`

The fixture-backed DEX encoder must compare both DTOs exactly against
`expectedDexCalls`. This catches public-to-DEX contract drift before real DEX
ports depend on the interface.

### Generic DEX Call Params

Port `buildGenericDexCallParams` exactly:

- `isMegaSwap = len(bestRoute) > 1`
- `isMultiSwap = !isMegaSwap && len(bestRoute[0].swaps) > 1`
- `isLastSwap = swapIndex == len(bestRoute[routeIndex].swaps)-1`
- BUY first-swap `srcAmount` is:

  ```text
  swapExchange.srcAmount * minMaxAmount / priceRoute.srcAmount
  ```

- SELL, and BUY swaps after the first, use `swapExchange.srcAmount`.
- SELL DEX `destAmount` is `"1"`.
- BUY DEX `destAmount` is `swapExchange.destAmount`.
- On BUY, `DexParamInput.SrcAmount` remains the original
  `swapExchange.srcAmount`; `ResolvedLeg.NormalizedSrcAmount` uses the
  slippage-adjusted call-param `srcAmount` above.
- If source token is native and DEX needs wrapped native:
  - DEX source token becomes wrapped native
  - WETH deposit amount increases by the DEX source amount
- Force unwrap when destination token is native, route is multi/mega, DEX does
  not need wrapped native, and this is not the last swap.
- If destination token is native and DEX needs wrapped native, DEX destination
  token becomes wrapped native and WETH withdraw amount increases by
  `swapExchange.destAmount`.
- Recipient is executor address when:
  - a WETH withdraw is needed after the swap
  - this is not the last swap
  - side is BUY
- Otherwise recipient is Augustus V6 address.

All tokens emitted to DEX inputs and resolved legs must be lowercase.

### WETH Plan

Port `buildResolvedWethPlan`:

- Sum per-leg WETH deposit and withdraw amounts using `big.Int`.
- If both sums are zero, omit `WethPlan`.
- If deposit equals withdraw and no route with native/wrapped tokens has mixed
  need-wrap-native values, omit `WethPlan`.
- The canonical mixed-need-wrap predicate is
  `hasAnyRouteWithEthAndDifferentNeedWrapNative` in
  `src/generic-swap-transaction-builder/orchestration.ts`. Port that helper by
  name. It scans ETH/WETH-touching legs per route and compares the
  `exchangeParam.needWrapNative` values for those legs; it does not compare the
  full `DexExchangeBuildParam`.
- Otherwise call `deps.WethProvider`.
- If `deps.WethProvider` is nil and a WETH plan is needed, use the default
  provider from `weth_provider.go`.

Default provider rules:

- deposit:
  - present when `SrcAmountWeth != "0"`
  - `callee = WrappedNativeTokenAddress`
  - `calldata = 0xd0e30db0`
  - `value = SrcAmountWeth`
- withdraw:
  - present when `DestAmountWeth != "0"`
  - also present for BUY if deposit is present, even when destination WETH
    amount is zero
  - `callee = NullAddress`
  - calldata is `withdraw(uint256)` with `DestAmountWeth`
  - `value = "0"`

The default provider must be deterministic and must not call `DexRegistry`.

### Approval Planning

Port `buildDexExchangeApprovalRequests` and
`applyDexExchangeApprovalDecisions`.

Approval request construction uses the same rules as
`src/executor/approval.ts`:

- `skipApproval` suppresses approval.
- target is `exchangeParam.spender` when present, otherwise
  `exchangeParam.targetExchange`.
- wrapped-native source plus `needUnwrapNative` suppresses approval.
- non-native source without `transferSrcTokenBeforeSwap` requests approval of
  swap source token to target.
- native source with `needWrapNative` requests approval of
  `exchangeParam.wethAddress` if present, otherwise
  `deps.EncodingContext.WrappedNativeTokenAddress`, to target.
- `permit2` is true when `exchangeParam.permit2Approval` is true.

Decision application:

- If approval decision is true, leave the leg unchanged.
- If false, set `exchangeParam.approveData` to lowercase `{token, target}`.
- Reject mismatched decision counts with:
  `approval decision length must match approval request count`
- Preserve resolved-leg order.

Checker rules:

- If `deps.Options.SkipApprovalCheck` is true, do not require or call
  `ApprovalChecker`; treat every approval request as not approved.
- If false and there are no approval requests, do not require
  `ApprovalChecker`.
- If false and approval requests exist, require `ApprovalChecker`.
- The checker receives the selected executor address as spender and the
  ordered approval requests.

### Resolved Input Assembly

Assemble `resolved.BuildInput` with:

- `RoutePlan` marshaled from the typed route plan.
- `ResolvedLegs` marshaled from typed resolved legs after approval decisions.
- `WethPlan` marshaled only when present.
- executor type/address from detector and deps.
- Augustus V6 and wrapped-native addresses from deps.
- network/block/tokens/amounts/side/contract method from normalized request.
- min/max amount from request.
- quoted amount after defaulting.
- deadline is not written into `resolved.BuildInput`.
- user, beneficiary, permit, UUID after defaulting.
- fee JSON from request fields after defaulting `IsCapSurplus`.
- gas pointer according to gas normalization rules.

Immediately before calling `resolved.BuildTransactionFromResolved`, compare the
assembled typed values against fixture `expectedResolvedInput` in tests. The
public builder should not rely only on final tx calldata parity.

Use an explicit test seam rather than inferring the assembled input through
final calldata:

```go
func buildGenericInput(
	ctx context.Context,
	req BuildRequest,
	deps Deps,
) (resolved.BuildInput, error)
```

`BuildGeneric` should call `buildGenericInput`, then call
`resolved.BuildTransactionFromResolved`. Fixture tests should call
`buildGenericInput` directly and compare its result to
`expectedResolvedInput` before separately calling `BuildGeneric` for
`params`/`txObject` parity. Keep `buildGenericInput` unexported; it is a test
seam, not public API.

### Test Helpers

Add `go/txbuilder/internal/publicbuildertest` helpers:

- `DecodeBuildRequest(fixture Fixture) (builder.BuildRequest, error)`
- `DecodeExpectedResolvedInput(fixture Fixture) (resolved.BuildInput, error)`
- `DecodeExpectedDexCalls(fixture Fixture) ([]ExpectedDexCall, error)`
- `DecodeApprovalDecisions(fixture Fixture) ([]bool, error)`
- `FixtureDexRegistry` implementing `builder.DexRegistry`
- `FixtureApprovalChecker` implementing `builder.ApprovalChecker`

`FixtureDexRegistry` behavior:

- records every registry lookup and DEX encoder call.
- rejects unexpected route-position calls.
- compares `NeedWrapNativeInput` and `DexParamInput` to fixture expectations.
- returns the fixture's `needWrapNative` and `dexParam`.
- exposes an assertion that all expected DEX calls were consumed exactly once.

`FixtureApprovalChecker` behavior:

- records spender and ordered approval requests.
- asserts spender equals the expected executor address derived from
  `expectedResolvedInput.executorAddress`.
- compares request route-position key, token, target, and Permit2 flag to
  fixture `expectedApprovalRequests`.
- returns fixture `approvalDecisions`.
- exposes a `Called` flag for skip-approval tests.

### Test Plan

Add public fixture parity tests in `go/txbuilder/builder`:

- For every Phase 2 public-builder fixture:
  - decode `BuildRequest`
  - build deps with real Go resolved ABI and executor factory
  - use `FixtureDexRegistry`
  - use `FixtureApprovalChecker`
  - call `BuildGeneric`
  - assert assembled resolved input equals `expectedResolvedInput`
  - assert output params equal `expectedParams`
  - assert output tx equals `expectedTx`
  - assert all expected DEX calls were consumed
  - assert approval checker requests match fixture expectations

Add focused unit tests:

- quoted amount nil defaults to dest amount for SELL.
- quoted amount nil defaults to src amount for BUY.
- quoted amount pointer to `""` defaults like nil.
- permit nil and pointer to `""` both become `0x`.
- beneficiary nil and beneficiary equal to user both become null address.
- `IsCapSurplus` nil defaults to true; explicit false stays false.
- all-empty gas fields produce nil gas.
- partial gas fields preserve only non-empty values.
- direct V6 method rejects before DEX lookup.
- unknown or V5 contract methods reject before DEX lookup.
- invalid side rejects before route planning.
- request network/context mismatch rejects before DEX lookup.
- missing Augustus V6, wrapped-native, or selected executor context address
  rejects before DEX lookup.
- Executor02 BUY/exact-out rejects before DEX lookup.
- Executor03 non-BUY rejects before DEX lookup.
- nil approval checker is allowed when no approval requests exist.
- nil approval checker fails when approval requests exist and skip is false.
- `SkipApprovalCheck` inserts approve data and does not call the checker.
- approval decision count mismatch returns the exact planned error.
- route-plan builder sums missing swap src/dest amounts.
- no-swap-amount fixture matches the same expected resolved input as the
  source with-amounts fixture.
- route-position keys use colon format.
- route planning, DEX calls, resolved legs, and approval requests preserve
  route-walk order, not DEX-key lexical order.
- executor detector unit tests cover every row of the route-shape table,
  including Executor02 mega-swap and vertical-branch SELL detection.
- WETH single-wrap detection follows the TypeScript predicate exactly and does
  not check destination token or route percent.
- `hasAnyRouteWithEthAndDifferentNeedWrapNative` matches the TypeScript helper
  behavior for same need-wrap values, mixed values, and non-ETH/WETH routes.
- WETH default provider emits exact deposit and withdraw calldata.

### Out Of Scope

- Tessera and every other real DEX encoder.
- HTTP DEX-param adapter.
- Direct public builder preprocessing.
- Runtime TypeScript-to-Go replacement.
- New resolved executor functionality beyond what current generic fixtures
  already support.

### Acceptance Checklist

- `BuildGeneric` exists and returns `resolved.BuildOutput`.
- Public-builder fixture schema includes DEX call and approval observations.
- Public-builder fixtures cover the Phase 2 matrix, including missing
  swap-level amount summing.
- Public-builder fixture parity tests pass with fixture-backed DEX params.
- Direct method and executor fence tests prove no DEX lookup happens.
- Approval planning tests cover approved, missing approval, skip-check, nil
  checker, and decision-count mismatch.
- WETH plan tests cover deposit, withdraw, BUY forced withdraw, and no-plan
  equal deposit/withdraw path.
- Existing resolved generic tests still pass.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.
- `yarn check:tsc`
- `yarn jest tests/generic-swap-transaction-builder/fixtures/go-public-builder-fixtures.test.ts --runInBand`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn fixtures:check`

### Handoff To Phase 3

After Phase 2, the Go public builder should be able to encode public generic
routes when DEX params are supplied by a fixture-backed registry. Phase 3 can
replace that test registry for Tessera with a real Go `DexEncoder`.

Phase 3 should not need to change `BuildGeneric`'s public signature or the DEX
port interfaces. If Tessera exposes a missing DEX param field, update the
Phase 1/2 DTO contract first and regenerate the fixture observations so the
interface remains portable to the future Go API service.
