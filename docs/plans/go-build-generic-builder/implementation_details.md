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
	Token   resolved.Address
	Target  resolved.Address
	Permit2 bool
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
