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
- The current transition service has a single-leg DEX-param HTTP contract, but
  Phase 1 should keep the Go builder core interface-driven.

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

## Phase 3: Tessera DEX Encoder Parity

### Goal

Add the first real Go `builder.DexEncoder` implementation for Tessera and
prove its single-leg `NeedWrapNative` / `GetDexParam` output against
TypeScript-generated fixtures.

Phase 3 should answer one narrow question: when the public builder calls the
portable DEX encoder port for a Tessera leg, can the Go Tessera encoder return
the same `DexExchangeParam` that the TypeScript Tessera builder returns?

Full public-route Tessera parity remains Phase 4. Phase 3 must not require any
`BuildGeneric` signature change, any HTTP endpoint dependency, or any runtime
TypeScript bridge.

### Source References

Use these implementations as the source material:

| Source                                      | Purpose                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/dex/tessera/tessera.ts`                | TypeScript parity source for `needWrapNative = true` and `getDexParam`.                              |
| `src/dex/tessera/config.ts`                 | TypeScript router-address config for Base and BSC.                                                   |
| `src/config.ts`                             | TypeScript wrapped-native address source for Base and BSC network config entries.                    |
| `src/abi/tessera/TesseraSwap.json`          | Canonical ABI for `tesseraSwapWithAllowances`.                                                       |
| `src/dex/tessera/tessera-e2e.test.ts`       | Route matrix that Phase 4 public fixtures will mirror; Phase 3 should mirror the DEX-param portions. |
| Existing single-leg DEX-param HTTP contract | Adapter semantics only; useful for field semantics, not the core builder architecture.               |

The existing Go Tessera implementation from `go-dex-lib` was used during
planning, but developer-local filesystem paths must not be committed as source
references. The portable behavior from that implementation is inlined below in
the amount, native-token, and focused-test sections.

### Current State

- Phase 2 `BuildGeneric` can call a `builder.DexRegistry` and consume
  `builder.DexExchangeParam`.
- Phase 2 tests use a fixture-backed registry. No real DEX encoder is
  registered yet.
- The existing TypeScript DEX-encoder fixture system already has
  `need-wrap-native` and `dex-param` fixture kinds, but the current committed
  generic fixtures are driven by resolved-build fixtures and do not include
  Tessera.
- Tessera's TypeScript `getDexParam` ignores `data` and emits one
  `tesseraSwapWithAllowances` call with empty `swapData`.
- Tessera's DEX encoder key is lowercase `tessera`, matching
  `Tessera.dexKeys = ['tessera']`. Phase 3 DEX-encoder fixtures use this exact
  lowercase key. Route-level exchange labels in later public-route fixtures are
  a Phase 4 concern because existing Tessera E2E routes use `exchange:
'Tessera'`.

### Execution Rule

Implement only Tessera `NeedWrapNative` and `GetDexParam` behind the existing
`builder.DexEncoder` interface.

Do not add:

- public-route Tessera fixtures or full `BuildGeneric` Tessera parity.
- a production `DexRegistry` that auto-registers Tessera for public builds.
- HTTP DEX-param adapter code.
- Tessera pricing, pool state, quoter, polling, or discovery logic.
- direct public builder support.

### File Layout

Add or update these paths:

| Path                                                                                      | Purpose                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `go/txbuilder/dex/tessera/encoder.go`                                                     | `builder.DexEncoder` implementation.                                                |
| `go/txbuilder/dex/tessera/config.go`                                                      | Base/BSC router and wrapped-native config used by the encoder.                      |
| `go/txbuilder/dex/tessera/abi.go`                                                         | Embedded Tessera swap ABI loader.                                                   |
| `go/txbuilder/dex/tessera/abi/tessera_swap.json`                                          | Copy of `src/abi/tessera/TesseraSwap.json`.                                         |
| `go/txbuilder/dex/tessera/encoder_test.go`                                                | Fixture parity and focused semantic tests.                                          |
| `go/txbuilder/dex/tessera/abi_test.go`                                                    | Drift test comparing embedded ABI copy with `src/abi/tessera/TesseraSwap.json`.     |
| `go/txbuilder/internal/dexencodertest/fixtures.go`                                        | Test-only loader for `tests/generic-swap-transaction-builder/dex-encoder/fixtures`. |
| `tests/generic-swap-transaction-builder/dex-encoder/dex-encoder-fixture-cases.ts`         | Add standalone Tessera fixture cases.                                               |
| `tests/generic-swap-transaction-builder/dex-encoder/dex-encoder-fixture-cases.ts` helpers | Add a network-aware DexHelper builder for Tessera Base/BSC cases.                   |
| `tests/generic-swap-transaction-builder/dex-encoder/dex-encoder-fixture-schema.ts`        | Validate lowercase `tessera` DEX data as `null`; reject unknown DEX keys.           |
| `tests/generic-swap-transaction-builder/dex-encoder/dex-encoder-fixtures.test.ts`         | Require Tessera fixture names and canonical regeneration coverage.                  |

Use `go/txbuilder/dex/tessera` rather than adding Tessera code to the public
`builder` package. DEX encoders are pluggable dependencies; the builder should
not know any concrete DEX implementation.

### Public Shape

Expose a small constructor:

```go
type Config struct {
	RouterByNetwork        map[int]resolved.Address
	WrappedNativeByNetwork map[int]resolved.Address
}

func DefaultConfig() Config
func New(config Config) *Encoder
```

`Encoder` implements:

```go
var _ builder.DexEncoder = (*Encoder)(nil)
```

Rules:

- `DefaultConfig` includes Base `8453` and BSC `56`.
- Router address for both supported chains is
  `0x55555522005bcae1c2424d474bfd5ed477749e3e`.
- Wrapped-native addresses must match the chain config used by TypeScript and
  the existing Go Tessera encoder:
  - Base WETH: `0x4200000000000000000000000000000000000006`
  - BSC WBNB: `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`
- Config values are normalized to lowercase once at construction.
- `Encoder` is immutable after `New`; methods must be safe for concurrent use
  by a registry shared across goroutines.
- `New` does not return an error. Tessera config validation is deferred to
  `GetDexParam`, so misconfiguration surfaces on the first call that uses the
  malformed network config.
- Missing router config causes `GetDexParam` to fail clearly with:
  `tessera: unsupported chain %d`. The wording intentionally matches the
  existing Go Tessera encoder and the HTTP adapter's chain-id terminology,
  even though the public builder DTO field is named `network`.
- `NeedWrapNative` is static `true` for any network, matching the TypeScript
  class field and the existing Go implementation. Chain support is enforced
  by `GetDexParam`, not by `NeedWrapNative`. In `BuildGeneric` ordering this
  means an unsupported Tessera network can pass the static `NeedWrapNative`
  call and then fail at `GetDexParam`; this is expected for Phase 3.

### ABI Rules

The encoder packs this method:

```text
tesseraSwapWithAllowances(
  address tokenIn,
  address tokenOut,
  int256 amountSpecified,
  uint256 amountCheck,
  address recipient,
  bytes swapData
)
```

Packing rules:

- Use `go-ethereum/accounts/abi`, matching the import path already used under
  `go/txbuilder/resolved`.
- Use `common.IsHexAddress` before `common.HexToAddress`; do not allow
  malformed nested addresses to be silently padded or truncated.
- `swapData` is always empty bytes (`[]byte{}`), matching TypeScript's `0x`.
- Output `ExchangeData` is lowercase `0x` hex.
- `TargetExchange` is the configured router address.
- `NeedWrapNative = true`.
- `DexFuncHasRecipient = true`.
- Every optional `builder.DexExchangeParam` field remains nil/absent in Phase
  3 unless TypeScript starts returning it.

Address validation errors should use a single format:

- `invalid request: tessera %s is not a valid address`

The field names should be `srcToken`, `destToken`, `recipient`, `router`, and
`wrappedNativeToken` where applicable.

### Amount Rules

Port the signed-amount convention from TypeScript and the validation hardening
summarized in this section.

SELL:

- `amountSpecified = srcAmount`
- `amountCheck = 0`
- `srcAmount` must parse as a decimal integer.
- `srcAmount` must be non-negative and `<= 2^255 - 1`.

BUY:

- `amountSpecified = -destAmount`
- `amountCheck = srcAmount`
- Per Phase 2, `DexParamInput.SrcAmount` for BUY is the original,
  unadjusted `swapExchange.srcAmount`, so Tessera's `amountCheck` is the
  unadjusted value, matching the TypeScript Tessera builder.
- `destAmount` must parse as a decimal integer, be positive, and be
  `<= 2^255 - 1`.
- `srcAmount` must parse as a decimal integer, be non-negative, and be
  `<= 2^256 - 1`.
- Reject zero BUY `destAmount`; otherwise `-0` encodes as `0` and silently
  changes the call semantics.

Unsupported side:

- fail with `invalid request: tessera unsupported swap side %q`.

Validation error strings should follow the existing Go Tessera implementation
where possible:

- `invalid request: tessera %s must be positive`
- `invalid request: tessera %s must be non-negative`
- `invalid request: tessera %s exceeds int256 maximum`
- `invalid request: tessera %s exceeds uint256 maximum`

The TypeScript builder does not enforce all of these bounds, but the Go
service-facing implementation already does. Phase 3 adopts that hardening
because it prevents silent ABI two's-complement reinterpretation.

### Native Token Rules

Tessera's router only accepts wrapped tokens.

Before ABI packing:

- If `srcToken` is native (`0xeeee...`) or zero address, replace it with the
  configured wrapped-native token for the input network.
- If `destToken` is native (`0xeeee...`) or zero address, replace it with the
  configured wrapped-native token for the input network.
- Already wrapped or ordinary ERC-20 tokens pass through normalized to
  lowercase.

Zero-address wrapping is Go hardening, not TypeScript fixture parity.
TypeScript `ConfigHelper.wrapETH` only wraps the `0xeeee...` native sentinel.
Do not add zero-address cases to TypeScript-generated Tessera parity fixtures
unless the TypeScript side intentionally changes too; keep zero-address
coverage as a focused Go-only semantic test.

When Phase 3 tests invoke the encoder directly, this wrapping happens inside
the Tessera encoder. When Phase 4 invokes Tessera through `BuildGeneric`, the
public builder may already have normalized native tokens to wrapped-native
tokens before `GetDexParam`; the Tessera encoder's wrapping must therefore be
idempotent.

### Fixture Generation

Extend `tests/generic-swap-transaction-builder/dex-encoder` fixtures with
standalone Tessera cases. These fixtures are not derived from resolved-build
fixtures because no committed resolved fixture currently contains Tessera.

Fixture generator rules:

- Instantiate the real TypeScript `Tessera` class with a minimal DexHelper for
  each supported network.
- Add a network-aware helper variant; the existing generic fixture generator's
  MAINNET-only helper is not sufficient for Tessera Base/BSC parity.
- `data` must be `null`. Tessera's `getDexParam` ignores data entirely;
  locking fixture data to `null` prevents accidentally adding a payload that
  callers might later rely on.
- `NeedWrapNativeInput` and `DexParamInput` should match the public builder
  DTO contract from Phase 1/2.
- Names should encode network, side, and native/wrapped case so failures are
  easy to localize.
- Example names:
  - `tessera-base-usdc-to-weth-sell`
  - `tessera-base-eth-to-usdc-sell`
  - `tessera-bsc-bnb-to-usdt-buy`

Required Phase 3 Tessera DEX-param fixture matrix:

| Fixture theme         | Network | Side | Source token posture | Destination token posture |
| --------------------- | ------- | ---- | -------------------- | ------------------------- |
| Base USDC -> WETH     | 8453    | SELL | ERC-20               | wrapped-native            |
| Base USDC -> ETH      | 8453    | SELL | ERC-20               | native                    |
| Base WETH -> USDC     | 8453    | SELL | wrapped-native       | ERC-20                    |
| Base ETH -> USDC      | 8453    | SELL | native               | ERC-20                    |
| Base USDC -> WETH BUY | 8453    | BUY  | ERC-20               | wrapped-native            |
| Base USDC -> ETH BUY  | 8453    | BUY  | ERC-20               | native                    |
| BSC WBNB -> USDT      | 56      | SELL | wrapped-native       | ERC-20                    |
| BSC BNB -> USDT       | 56      | SELL | native               | ERC-20                    |
| BSC USDT -> WBNB      | 56      | SELL | ERC-20               | wrapped-native            |
| BSC USDT -> BNB       | 56      | SELL | ERC-20               | native                    |
| BSC WBNB -> USDT BUY  | 56      | BUY  | wrapped-native       | ERC-20                    |
| BSC BNB -> USDT BUY   | 56      | BUY  | native               | ERC-20                    |

These are the DEX-param counterparts of
`src/dex/tessera/tessera-e2e.test.ts`. Phase 4 will reuse the same economic
routes for full public builder fixtures.

Each case should generate:

- one `need-wrap-native` fixture with expected `true`.
- one `dex-param` fixture with expected `DexExchangeParam`.

Update the existing DEX-encoder fixture coverage gate instead of weakening it:

- `direct-param` DEX keys must still equal the direct resolved-build DEX key
  set exactly.
- `dex-param` and `need-wrap-native` DEX keys must equal the generic
  resolved-build DEX key set plus the standalone `tessera` key.
- Add an explicit required-name check for every Tessera fixture in the matrix
  so a generator bug cannot satisfy the key-set assertion with only one
  Tessera case.

Update `validateDexSpecificData` with an explicit lowercase `tessera` branch
that requires `data === null`, and add a final `throw` for unknown DEX keys.
This prevents a casing typo such as `Tessera` or an unsupported key from
silently bypassing DEX-specific data validation.

### Go Fixture Tests

Add a Go fixture loader under `internal/dexencodertest` that can read the
existing TS dex-encoder fixture root and filter by `dexKey == "tessera"`
case-sensitively.

The loader should mirror `internal/publicbuildertest` conventions:

- `Collection` and `Fixture` wrapper types.
- raw bytes preserved for optional canonical-byte diagnostics.
- recursive fixture walk from the repository root.
- schema-version and kind validation before test use.

Tests:

- `TestTesseraNeedWrapNativeFixtures`
  - load every Tessera `need-wrap-native` fixture.
  - call `Encoder.NeedWrapNative`.
  - assert expected `true`.
- `TestTesseraDexParamFixtures`
  - load every Tessera `dex-param` fixture.
  - decode fixture input into `builder.DexParamInput`.
  - call `Encoder.GetDexParam`.
  - compare output to fixture expected value:
    - exact `NeedWrapNative`.
    - exact `DexFuncHasRecipient`.
    - exact lowercase `ExchangeData`.
    - exact lowercase `TargetExchange`.
    - nil optional fields remain nil.
- On mismatch, decode the Tessera calldata and report the six method arguments
  (`tokenIn`, `tokenOut`, `amountSpecified`, `amountCheck`, `recipient`,
  `swapData`) before raw hex. Do not leave implementers debugging only a long
  calldata string.

### Focused Unit Tests

Port the semantic coverage described below into this repo, adapted to
`builder.DexParamInput`:

- SELL happy path:
  - selector matches
    `tesseraSwapWithAllowances(address,address,int256,uint256,address,bytes)`.
  - `amountSpecified = srcAmount`.
  - `amountCheck = 0`.
  - `swapData` is empty bytes.
- BUY happy path:
  - same selector as SELL.
  - `amountSpecified = -destAmount`.
  - `amountCheck = srcAmount`.
- Base native source wraps to Base WETH.
- Base native destination wraps to Base WETH.
- Wrapped-native source token passes through unchanged, proving native wrapping
  is idempotent for Phase 4.
- BSC native source wraps to BSC WBNB.
- zero-address source wraps like native.
- unsupported network returns `tessera: unsupported chain %d`.
- invalid side returns `invalid request: tessera unsupported swap side %q`.
- SELL `srcAmount = 2^255 - 1` is accepted.
- SELL `srcAmount = 2^255` is rejected.
- SELL negative `srcAmount` is rejected.
- BUY nil/empty or zero `destAmount` is rejected.
- BUY `destAmount = 2^255` is rejected.
- BUY `srcAmount = 2^256` is rejected.
- malformed src, dest, recipient, router, or wrapped-native addresses fail
  before ABI packing with the planned address error format.
- decoded `swapData` length is exactly zero bytes, not one zero byte.
- identical inputs produce identical calldata bytes.

### Out Of Scope

- Public Tessera `BuildGeneric` fixtures.
- Production Tessera registry wiring.
- HTTP endpoint adapter.
- RPC, Redis, polling, pricing, state snapshots, or quoter math.
- Tessera e2e / Tenderly simulation from Go.
- Any non-Tessera DEX encoder.

### Acceptance Checklist

- `go/txbuilder/dex/tessera` implements `builder.DexEncoder`.
- Tessera ABI drift test passes against `src/abi/tessera/TesseraSwap.json`.
- Tessera config tests prove Base/BSC router and wrapped-native values match
  the TypeScript sources.
- TypeScript dex-encoder fixtures include Tessera Base/BSC SELL/BUY and
  native/wrapped cases.
- Go Tessera fixture tests pass against TypeScript-generated fixture output.
- Focused amount, native-wrap, unsupported-network, and malformed-address tests
  pass.
- Phase 3 does not modify `go/txbuilder/builder` source files.
- No developer-local `go-dex-lib` filesystem paths remain in committed plan or
  implementation files.
- Existing Phase 2 public-builder fixture-backed tests continue to pass.
- Existing resolved generic tests continue to pass.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.
- `yarn check:tsc`
- `yarn jest tests/generic-swap-transaction-builder/dex-encoder/dex-encoder-fixtures.test.ts --runInBand`
- `yarn fixtures:check`

### Handoff To Phase 4

After Phase 3, Tessera can produce real Go `DexExchangeParam` values for one
leg, but `BuildGeneric` still uses fixture-backed registries in its public
builder parity suite.

Phase 4 should:

- add a concrete registry or test registry that maps Tessera's DEX keys to the
  new Tessera encoder.
- canonicalize public route exchange labels before registry lookup. At minimum
  Phase 4 must map both `tessera` and the existing route label `Tessera` to the
  same Tessera encoder, or define a stricter price-route contract and update
  TypeScript fixture generation to emit the canonical lowercase key.
- generate public-builder Tessera fixtures from the TypeScript public builder,
  mirroring `src/dex/tessera/tessera-e2e.test.ts`.
- run `BuildGeneric` end-to-end with the real Tessera encoder and compare
  resolved input, params, and tx object.
- only then decide whether to add a temporary HTTP adapter that maps
  `builder.DexParamInput` to the existing single-leg DEX-param HTTP contract.

## Phase 4: Tessera Public Builder End-To-End Parity

### Goal

Wire the real Go Tessera encoder into the public Go generic builder and prove
that public Tessera routes produce the same resolved input, generic params, and
transaction object as the TypeScript public `GenericSwapTransactionBuilder`.

Phase 4 is the first end-to-end proof that the Go builder can accept a public
`priceRoute`, call a real in-process Go DEX encoder, plan approvals and WETH
calls, build executor bytecode, and emit the same Augustus V6 transaction as
TypeScript.

### Current State

- Phase 2 `BuildGeneric` is implemented and fixture-tested with a
  fixture-backed DEX registry.
- Phase 3 `go/txbuilder/dex/tessera` implements `builder.DexEncoder` and
  matches TypeScript Tessera `NeedWrapNative` and `GetDexParam` fixtures.
- The public-builder fixture generator already records TypeScript public
  builder runs with `resolvedBuildInputObserver`, DEX-call observations, and
  approval observations.
- Existing public-builder fixtures do not contain Tessera routes.
- `BuildGeneric` currently passes `swapExchange.Exchange` through unchanged to
  `DexRegistry.GetDexEncoder` and into `DexParamInput.DexKey`.

### Execution Rule

Implement only Tessera public-route parity. Do not add a production registry for
every DEX, an HTTP DEX-param adapter, RPC/Redis approval lookup, direct public
builder support, or Tenderly/e2e simulation from Go.

Do not add Tessera-specific casing logic to `go/txbuilder/builder`. The builder
must remain DEX-agnostic. Route-label alias handling belongs in a concrete
registry implementation or test registry.

### Source References

Use these sources:

| Source                                                                                   | Purpose                                                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/dex/tessera/tessera-e2e.test.ts`                                                    | Public Tessera route matrix and route-label casing currently used by TypeScript tests.       |
| `src/dex/tessera/tessera.ts`                                                             | Tessera DEX key and `getDexParam` semantics.                                                 |
| `tests/generic-swap-transaction-builder/fixtures/generate-go-public-builder-fixtures.ts` | Existing public-builder fixture recorder to extend with real Tessera public runs.            |
| `go/txbuilder/builder/build.go`                                                          | Public Go builder route-walk, DEX registry, approval, WETH-plan, and resolved-call boundary. |
| `go/txbuilder/dex/tessera`                                                               | Real Go Tessera encoder from Phase 3.                                                        |
| Existing single-leg DEX-param HTTP contract                                              | Adapter reference only; Phase 4 should not couple the core builder to HTTP.                  |

No developer-local filesystem paths should be added as references.

### File Layout

Add or update these paths:

| Path                                                                                     | Purpose                                                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `go/txbuilder/dex/registry/registry.go`                                                  | Small reusable alias-aware static `builder.DexRegistry`.                                     |
| `go/txbuilder/dex/registry/registry_test.go`                                             | Alias lookup, unknown DEX, nil encoder, and network pass-through tests.                      |
| `go/txbuilder/builder/tessera_public_test.go`                                            | Public `BuildGeneric` tests using the real Tessera encoder and recorded TypeScript fixtures. |
| `go/txbuilder/internal/publicbuildertest/real_registry.go`                               | Test-only recorder that wraps a real registry and compares observed DEX calls.               |
| `tests/generic-swap-transaction-builder/fixtures/generate-go-public-builder-fixtures.ts` | Add Tessera public fixture generation from real TypeScript public builder runs.              |
| `tests/generic-swap-transaction-builder/fixtures/go-public-builder-schema.ts`            | Require `dexKeys` to equal the unique route exchange labels in `input.request.priceRoute`.   |
| `tests/generic-swap-transaction-builder/fixtures/go-public-builder-fixtures.test.ts`     | Require Tessera public fixture names and verify generator/schema coverage.                   |
| `tests/generic-swap-transaction-builder/fixtures/go-public-builder/generic-public/`      | Add committed Tessera public-builder fixtures.                                               |

If the registry is useful only for tests after implementation, keep it under
`go/txbuilder/internal/...`. Prefer `go/txbuilder/dex/registry` if it is a
small generic alias registry the future Go API service can reuse.

### Registry Design

Add an alias-aware static registry with no Tessera imports in the builder
package.

Suggested public shape:

```go
type Entry struct {
	Keys    []string
	Encoder builder.DexEncoder
}

func New(entries ...Entry) (builder.DexRegistry, error)
func MustNew(entries ...Entry) builder.DexRegistry
```

Rules:

- Lookup is exact by key after explicit alias registration. Do not lowercase
  all unknown keys globally; route-label casing is part of the public input
  contract.
- Phase 4 registers both `tessera` and `Tessera` to the same
  `tessera.Encoder`.
- `New` rejects an entry with an empty `Keys` slice, any empty-string key, any
  nil encoder, and any duplicate key across entries. Duplicate-key errors
  should be explicit, for example `duplicate dex registry key %q`.
- `MustNew` is only a convenience for tests and static setup; it panics on
  invalid construction input. Production/service code should use `New` and
  handle the error.
- Unknown DEX fails clearly, for example:
  `dex encoder not found for %s on network %d`.
- The registry must pass the requested network to errors and any wrapper
  diagnostics, but Tessera network support remains enforced inside the Tessera
  encoder.
- The registry does not mutate the DEX key. `BuildGeneric` continues to pass
  the original route label into `DexParamInput.DexKey`, matching TypeScript's
  public-builder observation surface.

This preserves portability: the future Go API service can replace this static
registry with its own service registry without changing `BuildGeneric`.

Registry unit tests must cover:

- lookup `Tessera` returns the registered encoder.
- lookup `tessera` returns the same registered encoder.
- lookup `TESSERA` fails, proving there is no global lowercasing fallback.
- duplicate key, empty key, empty key list, and nil encoder fail clearly.

### Tessera Public Fixture Matrix

Mirror `src/dex/tessera/tessera-e2e.test.ts` exactly for route economics and
route shape. Public routes should use `exchange: "Tessera"` because that is the
route label used by the existing TypeScript Tessera e2e route builder.

Required fixture names:

| Fixture name                     | Network | Side | Route theme           |
| -------------------------------- | ------- | ---- | --------------------- |
| `tessera-base-usdc-to-weth-sell` | Base    | SELL | ERC-20 -> wrapped     |
| `tessera-base-usdc-to-eth-sell`  | Base    | SELL | ERC-20 -> native      |
| `tessera-base-weth-to-usdc-sell` | Base    | SELL | wrapped -> ERC-20     |
| `tessera-base-eth-to-usdc-sell`  | Base    | SELL | native -> ERC-20      |
| `tessera-base-usdc-to-weth-buy`  | Base    | BUY  | ERC-20 -> wrapped BUY |
| `tessera-base-usdc-to-eth-buy`   | Base    | BUY  | ERC-20 -> native BUY  |
| `tessera-bsc-wbnb-to-usdt-sell`  | BSC     | SELL | wrapped -> ERC-20     |
| `tessera-bsc-bnb-to-usdt-sell`   | BSC     | SELL | native -> ERC-20      |
| `tessera-bsc-usdt-to-wbnb-sell`  | BSC     | SELL | ERC-20 -> wrapped     |
| `tessera-bsc-usdt-to-bnb-sell`   | BSC     | SELL | ERC-20 -> native      |
| `tessera-bsc-wbnb-to-usdt-buy`   | BSC     | BUY  | wrapped -> ERC-20 BUY |
| `tessera-bsc-bnb-to-usdt-buy`    | BSC     | BUY  | native -> ERC-20 BUY  |

Use the same block numbers and token amounts as the e2e source. Use fixed
public build fields so output is deterministic:

- `minMaxAmount`: SELL uses the route `destAmount`; BUY uses the route
  `srcAmount`.
- `quotedAmount`: omit unless a fixture intentionally tests pass-through.
  Defaulting is already covered in Phase 2.
- `partnerAddress`, `partnerFeePercent`, surplus flags, gas, permit, UUID,
  user address, and beneficiary should be fixed across the matrix unless a
  specific route requires otherwise.
- `input.options.skipApprovalCheck = false`.
- Approval decisions should default to all `true` to isolate Tessera
  DEX/WETH/executor parity from approval insertion. Phase 2 already covers
  missing-approval and skip-approval behavior.

The matrix is expected to route 8 SELL fixtures through Executor01 and 4 BUY
fixtures through Executor03. It should not exercise Executor02 fences or the
ExecutorWETH single-wrap optimization because Tessera is not a WETH-only
exchange and every fixture is single-route / 100 percent / single-swap /
single-exchange.

Native-source SELL routes still generate approval requests for the
wrapped-native token against the Tessera router. With all-true approval
decisions, those resolved legs should not contain `approveData`; this is
intentional because Phase 2 already covers approval insertion and
`SkipApprovalCheck` behavior.

Tessera DEX-param encoding is deterministic and does not require a live fork.
The e2e source's block numbers and amounts can be reused directly by the
fixture generator.

### TypeScript Fixture Generation

Extend the public-builder fixture generator with a real Tessera path instead
of deriving Tessera fixtures from resolved-build fixtures.

Generator rules:

- The generator becomes dual-mode: existing non-Tessera fixtures continue to
  derive from `loadResolvedBuildFixtures()`, while Phase 4 Tessera fixtures are
  produced by a fresh public-builder run because no committed Tessera
  resolved-build fixtures exist.
- Build each Tessera `PriceRoute` from the same data as
  `src/dex/tessera/tessera-e2e.test.ts`.
- Reuse the network-aware DexHelper variant from Phase 3 to instantiate the
  real TypeScript `Tessera` class across Base and BSC. The minimal helper must
  include the fields Tessera reads: `web3Provider.eth.Contract`,
  `config.data.network`, `config.data.augustusV6Address`,
  `config.data.wrappedNativeTokenAddress`, and `config.wrapETH`.
- Run the real TypeScript `GenericSwapTransactionBuilder.build(...)` twice:
  once with `onlyParams: false` and once with `onlyParams: true`.
- Use `resolvedBuildInputObserver.onGenericBuildInput` to capture the actual
  TypeScript resolved input.
- Use a recording real DEX registry:
  - wrap the existing `DexAdapterService` lookup or
    `createTsDexEncoderRegistry` behavior so recorded alias handling matches
    the production TypeScript adapter.
  - Phase 4 may directly construct the TypeScript `Tessera` class behind
    `createTsDexEncoderRegistry` because Tessera's encoder is class-stateless
    for this path. For future DEX encoders with adapter-mediated state, the
    recorder should wrap a real `DexAdapterService` instance instead.
  - forward aliases that the production TypeScript adapter accepts; do not
    invent alias semantics that are absent from the production path.
  - record `NeedWrapNativeInput`, `needWrapNative`, `DexParamInput`, and
    returned `DexExchangeParam`.
  - do not hand-assemble Tessera `DexExchangeParam` from Go expectations.
- Use a recording approval service that records approval pairs and returns a
  deterministic all-true decision list for the number of requests it receives.
  Store both `expectedApprovalRequests` and `approvalDecisions` in the fixture.
- Assert the tx run and params run produce identical captured resolved input,
  DEX observations, and approval observations.
- Fixture `dexKeys` should contain the public route label observed in the
  route (`Tessera`), not a silently lowercased key. The real Go registry proves
  alias handling.
- The fixture schema/test contract must assert `dexKeys` equals the sorted
  unique set of `input.request.priceRoute.bestRoute[*].swaps[*].swapExchanges[*].exchange`
  labels. This prevents alias proof from being weakened by drift between
  fixture metadata and the actual public route.
- `expectedDexCalls[*].dexKey` and nested `DexParamInput.dexKey` should also
  remain `Tessera` for these public fixtures because `BuildGeneric` passes the
  route label through unchanged. Do not normalize those fixture fields to
  lowercase.
- Keep standalone Phase 3 DEX-encoder fixtures lowercase `tessera`; public
  Phase 4 fixtures intentionally exercise the public route label `Tessera`.
- Existing public fixtures keep their original DEX keys, such as `UniswapV3`,
  without modification.
- No public-builder schema shape change is expected for Tessera. Only add a
  schema rule if the generated fixture exposes a concrete contract gap; do not
  broaden or weaken validation solely to fit Tessera.

### Go End-To-End Tests

Add a new real-registry Tessera public test instead of replacing the existing
fixture-backed public-builder test.

Keep these tests in `tessera_public_test.go` so fixture-backed public-builder
failures and real Tessera encoder failures are diagnosed independently.

Test flow for every Tessera public fixture:

1. Load the public-builder fixture by name.
2. Decode `BuildRequest`, `expectedResolvedInput`, `expectedParams`, and
   `expectedTx`.
3. Build fresh deps for the input-only pass with:
   - Phase 1/2 resolved deps helper.
   - `executor.NewFactory()`.
   - real Tessera encoder from `tessera.New(tessera.DefaultConfig())`.
   - alias registry mapping both `Tessera` and `tessera`.
   - fixture approval checker using `expectedApprovalRequests` and
     `approvalDecisions`.
4. Wrap the real registry with a test recorder that captures Go DEX calls and
   compares them to fixture `expectedDexCalls`:
   - route position key.
   - lookup key / `dexKey`.
   - `NeedWrapNativeInput`.
   - `needWrapNative`.
   - `DexParamInput`.
   - returned `DexExchangeParam`.
5. Call `builder.BuildGenericInputForTest` and compare the resolved input to
   `expectedResolvedInput`.
6. Assert the input-pass approval checker and DEX recorder consumed exactly the
   expected observations.
7. Build a second fresh deps/recorder/checker set for the output pass. Do not
   reuse the input-pass instances; the registries and checkers are stateful and
   would otherwise double-consume observations.
8. Call `builder.BuildGeneric` and compare `params` and `txObject`.
9. Assert the output-pass approval checker and DEX recorder consumed exactly
   the expected observations.

The existing `TestBuildGenericPublicFixtures` should continue to run all
public-builder fixtures with a fixture-backed DEX registry. The new real
Tessera test proves that those same Tessera fixtures also pass with real Go
DEX encoding.

### Byte-Level Diagnostics

Use existing resolved calldata diff helpers where possible.

On a Tessera public mismatch, tests should report:

- fixture name.
- resolved input JSON mismatch location where available.
- tx calldata selector and first differing byte offset.
- expected vs got `executorData` byte length when generic calldata differs.
- recorded Tessera `exchangeData` mismatch decoded as
  `tesseraSwapWithAllowances(tokenIn, tokenOut, amountSpecified, amountCheck,
recipient, swapData)` before printing raw hex.

Do not leave failures as only full JSON dumps or long raw calldata strings.

### Implementation Order

1. Add the alias-aware static registry and unit tests.
2. Extend public-builder fixture generation with the Tessera public matrix and
   real TypeScript Tessera recording registry.
3. Regenerate public-builder fixtures and update fixture schema/tests to
   require the 12 Tessera names.
4. Add Go Tessera public real-registry tests.
5. Fix any exposed resolved/executor gaps with fixture coverage in the same
   phase.
6. Run the full Phase 4 gate list.

We do not expect the Tessera matrix to expose new resolved/executor gaps because
all routes are single-route / 100 percent / single-swap / single-exchange and
flow through Executor01 for SELL or Executor03 for BUY. If a gap does surface,
decide whether it is truly required for Tessera public parity in Phase 4 or
should become a separate follow-up plan.

### Out Of Scope

- A production all-DEX registry.
- HTTP DEX-param adapter implementation.
- RPC/Redis-backed approval checker.
- Go-side pricing, pool discovery, polling, quoter calls, or route generation.
- Tenderly simulation or on-chain e2e tests from Go.
- Direct public builder preprocessing.
- Non-Tessera public-route parity fixtures.
- Replacing the TypeScript runtime path in production.

### Acceptance Checklist

- Public-builder fixtures include all 12 Tessera route cases listed above.
- Tessera public fixtures are generated by running the real TypeScript public
  builder with real TypeScript Tessera encoding and recording observations.
- The Go alias registry maps both `Tessera` and `tessera` to the real Go
  Tessera encoder without changing `BuildGeneric`.
- Go real-registry Tessera public tests match:
  - `expectedDexCalls`.
  - `expectedApprovalRequests`.
  - `expectedResolvedInput`.
  - `expectedParams`.
  - `expectedTx`.
- Existing fixture-backed public-builder tests continue passing for all public
  fixtures, including Tessera.
- Phase 3 standalone Tessera DEX-encoder tests continue passing.
- Existing resolved generic tests continue passing.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.
- `yarn check:tsc`
- `yarn jest tests/generic-swap-transaction-builder/fixtures/go-public-builder-fixtures.test.ts --runInBand`
- `yarn jest tests/generic-swap-transaction-builder/dex-encoder/dex-encoder-fixtures.test.ts --runInBand`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`
- `yarn fixtures:check`

Phase 4 should not modify Phase 3 standalone DEX-encoder fixtures. The
`dex-encoder-fixtures.test.ts` gate remains here to catch accidental
regressions while public Tessera fixtures are added.

### Handoff To Phase 5

After Phase 4, Go should prove full public generic encoding for a real DEX via
in-process Go code. Phase 5 can decide how this builder is integrated into the
future Go API service:

- document the final portable `BuildGeneric` API and dependency wiring.
- decide whether the service uses the small alias registry, its own registry,
  or generated DEX registration.
- decide whether an HTTP adapter for the existing single-leg DEX-param
  contract is still useful as a transition layer.
- document which approval checker implementation will supply real RPC/Redis
  decisions outside fixture tests.
