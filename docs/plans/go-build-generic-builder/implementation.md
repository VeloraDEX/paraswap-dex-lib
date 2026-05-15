# Go Public Generic Builder Implementation Plan

## Summary

Add a portable Go implementation of the public generic
`GenericSwapTransactionBuilder.build(...)` path. The builder accepts the same
or closely equivalent inputs as the TypeScript public `build({ ... })` method,
converts `priceRoute + build params` into `resolved.BuildInput`, and reuses
the existing Go `resolved.BuildTransactionFromResolved` encoder.

This plan is generic-route only. Direct public preprocessing remains a later
plan. The core design must be portable to the future Go API service, where DEX
param encoding is satisfied by in-process Go DEX encoders.

The current DEX param HTTP endpoint described in `tmp/DEX-PARAM-API.md` is an
adapter option, not the builder's core architecture. The builder depends on Go
interfaces for DEX encoding. One implementation can call the HTTP endpoint
during transition; another implementation can call in-process Go encoders in
the future service. Moving between those implementations must not require
rewriting the public builder.

## Parity Definition

For this plan, Go public-builder parity means:

- Given the same public build request as TypeScript, Go produces the same
  normalized resolved `BuildInput`.
- `params` deep-equal the TypeScript baseline after JSON-shaped normalization.
- `txObject.from`, `txObject.to`, and `txObject.data` match exactly as
  lowercase `0x` hex strings.
- `txObject.value` matches exactly as a decimal string.
- Optional gas fields match exactly as decimal strings when present.
- Unsupported route shapes fail before DEX lookup when this plan explicitly
  keeps them out of scope.

## Phases

### 1. Public Contract And Fixture Foundation

Phase 1 creates the public builder contract, fixture contract, and test
scaffolding without implementing public build orchestration.

#### In Scope

- Add a package such as:

  ```text
  go/txbuilder/builder
  ```

- Define the public generic entry point shape:

  ```go
  func BuildGeneric(ctx context.Context, req BuildRequest, deps Deps) (resolved.BuildOutput, error)
  ```

  Phase 1 may leave this unimplemented or absent; do not add a stub that can
  accidentally become a production entry point before Phase 2.

- Define `BuildRequest`, mirroring TypeScript public `build({ ... })`:

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

- Define `PriceRoute` as a new builder-package public DTO, not
  `resolved.RoutePlan`:

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

- Preserve TypeScript route-plan amount behavior: when
  `PriceRouteSwap.SrcAmount` or `DestAmount` is nil, route-plan generation
  later sums the corresponding swap-exchange amounts, matching
  `src/executor/route-plan.ts`.

- Define dependency and option types:

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

- Define interfaces and local DTOs:

  - `DexRegistry`
  - `DexEncoder`
  - `NeedWrapNativeInput`
  - `DexParamInput`
  - builder-local `DexExchangeParam`
  - `ApprovalChecker`
  - `ApprovalRequest`
  - `WethCallDataProvider`

- Add TypeScript-generated public-builder fixture tooling:
  - generator path:
    `tests/generic-swap-transaction-builder/fixtures/generate-go-public-builder-fixtures.ts`
  - fixture root:
    `tests/generic-swap-transaction-builder/fixtures/go-public-builder/`
  - `yarn fixtures:check` regeneration and untracked-file coverage.

#### Contract Details

`BuildGeneric` returns both `params` and `txObject` in
`resolved.BuildOutput`. There is no core `onlyParams` branch. This is a
deliberate Go API divergence from TypeScript's `onlyParams` return union; any
TS or legacy adapter layered on top of this API must choose whether to return
`params` or `txObject`.

`Options.SkipApprovalCheck` is the Go equivalent of the TypeScript builder
constructor option, not a per-call public build field. If true,
`ApprovalChecker` may be nil and must not be called. If false,
`ApprovalChecker` may be nil only when the route produces zero approval
requests.

`Deadline` is required for TypeScript public API compatibility but unused by
current generic V6 encoding.

#### Out Of Scope

- No public build orchestration.
- No DEX param encoding.
- No Tessera encoder.
- No HTTP endpoint adapter implementation.
- No direct public builder path.

#### Acceptance

- Public DTOs and interfaces compile.
- TypeScript fixture generator emits canonical public-builder fixture files.
- `yarn fixtures:check` covers the new fixture root.
- Go fixture loader tests can load the public-builder fixture metadata.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.

### 2. Generic Orchestration With Fixture-Backed DEX Params

Phase 2 ports public generic preprocessing and proves it independently from
real Go DEX encoders by using fixture-backed DEX param responses.

#### In Scope

- Implement `BuildGeneric(ctx, req, deps)`.
- Port defaulting rules:
  - `quotedAmount`: nil or empty string means SELL uses
    `priceRoute.destAmount`; BUY uses `priceRoute.srcAmount`.
  - `beneficiary`: `NULL_ADDRESS` when unset or equal to `userAddress`.
  - `permit`: nil or empty string means `0x`.
  - `isCapSurplus`: `true` when unset.
  - `takeSurplus`, `isSurplusToUser`, and `isDirectFeeTransfer`: `false`.
- Normalize gas into `resolved.BuildInput.Gas`:
  - if all gas fields are nil or empty strings, use nil
  - if any gas field is non-empty, allocate `GasInput` and copy only non-empty
    values
  - empty gas strings are absent, not parity fields
- Reject direct V6 contract methods before route planning, DEX lookup, WETH
  planning, approval checks, or resolved encoding.
- Detect executor type from public route shape and side, including WETH
  single-wrap optimization.
- Prevalidate current resolved executor fences before DEX lookup:
  - Executor02 with BUY / `swapExactAmountOut*` returns
    `Executor02 BUY routes are not implemented in Phase 2c`
  - Executor03 with non-BUY / non-`swapExactAmountOut*` returns
    `Executor03 non-BUY routes are not implemented in Phase 2d`
- Lowercase all public address inputs before resolved encoding:
  - price-route tokens
  - user, partner, referrer, and beneficiary
  - executor, Augustus V6, and wrapped-native addresses
- Build `NeedWrapNativeInput` for each route leg.
- Build per-leg DEX call params:
  - wrapped/native token normalization
  - SELL and BUY amount handling
  - recipient selection between executor and Augustus V6
  - WETH deposit/withdraw counters
- Call the DEX encoder port for each route leg.
- Build the optional WETH plan.
- Build and apply approval decisions.
- Assemble `resolved.BuildInput`.
- Call `resolved.BuildTransactionFromResolved`.
- Add a fixture-backed `DexRegistry` test helper that returns committed
  TypeScript DEX params from fixtures. This proves orchestration without
  requiring every DEX encoder to be ported to Go.

#### Canonical Helpers To Port

| TypeScript source                                                    | Helper / behavior                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/executor/route-plan.ts`                                         | `buildRoutePlan`, `walkRoutePlan`, `routePositionKey`                                                                                                                                       |
| `src/executor/ExecutorDetector.ts`                                   | `ExecutorDetector.getExecutorByPriceRoute` and route-type detection                                                                                                                         |
| `src/executor/WETHBytecodeBuilder.ts`                                | WETH single-wrap route detection                                                                                                                                                            |
| `src/generic-swap-transaction-builder/orchestration.ts`              | `resolveQuotedAmount`, `resolveBeneficiary`, `resolvePermit`, `buildGenericDexCallParams`, `buildResolvedWethPlan`, `buildDexExchangeApprovalRequests`, `applyDexExchangeApprovalDecisions` |
| `src/generic-swap-transaction-builder/resolved/build-transaction.ts` | `buildFeesV6` call semantics via existing Go fee builder                                                                                                                                    |
| `src/generic-swap-transaction-builder/dex-encoder/types.ts`          | `NeedWrapNativeInput`, `DexParamInput`, and `DexExchangeParam` DTO contracts                                                                                                                |

#### Port Contracts

`DexParamInput` uses the audited TypeScript port contract from
`src/generic-swap-transaction-builder/dex-encoder/types.ts`. It includes the
endpoint-like fields plus `dexKey` and embedded route/swap/swap-exchange
context:

- `dexKey`
- `srcToken`
- `destToken`
- `srcAmount`
- `destAmount`
- `recipient`
- opaque `data`
- `side`
- `executorAddress`
- route context: network, side, route index, route percent, block number,
  global src/dest tokens and amounts
- swap context: swap index, src/dest tokens, summed src/dest amounts
- swap-exchange context: index, exchange, percent, src/dest amounts, and
  opaque data

`DexExchangeParam` is a builder-local output type with plain
`NeedWrapNative bool`, not `resolved.DexExchangeBuildParam`:

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

`BuildGeneric` calls `DexEncoder.NeedWrapNative(...)` before DEX call-param
construction, then calls `DexEncoder.GetDexParam(...)`; if
`DexExchangeParam.NeedWrapNative` differs from the precomputed value, fail
before resolved encoding.

`ApprovalRequest` is a struct:

```go
type ApprovalRequest struct {
	RoutePositionKey string
	Token            resolved.Address
	Target           resolved.Address
	Permit2          bool
}
```

`RoutePositionKey` is intentionally part of the checker port. Production
checkers may ignore it, but it gives adapters and tests a stable route-walk
identifier for logging, debugging, and validating that approval decisions are
applied to the intended leg. `Check` returns one boolean per request in the
same order: `true` means the approval already exists, and `false` means the
builder inserts `approveData` for that route leg.

#### WETH Provider Rules

Default WETH calldata must match TypeScript:

- when `srcAmountWeth != "0"`, add `deposit` with:
  - `callee = encodingContext.wrappedNativeTokenAddress`
  - `calldata = deposit()`
  - `value = srcAmountWeth`
- if side is BUY and a deposit is created, also force a `withdraw` entry even
  when `destAmountWeth == "0"`
- when forced by BUY deposit or when `destAmountWeth != "0"`, add `withdraw`
  with:
  - `callee = NULL_ADDRESS`
  - `calldata = withdraw(destAmountWeth)`
  - `value = "0"`

The default provider must not depend on a DEX registry.

#### Out Of Scope

- No real Go DEX encoder parity yet.
- No Tessera encoder.
- No HTTP endpoint adapter implementation.
- No direct public builder path.

#### Acceptance

- Public builder with fixture-backed DEX params reproduces TypeScript observed
  resolved `BuildInput` for committed generic public-builder fixtures.
- Public builder output matches committed `params` and `txObject`.
- Direct V6 methods are rejected before DEX lookup.
- Executor02 BUY / exact-out and Executor03 non-BUY fences are rejected before
  DEX lookup.
- Approval tests cover:
  - approved means no `approveData`
  - missing approval inserts `approveData`
  - `SkipApprovalCheck` inserts `approveData` without calling the checker
  - decision-count mismatch fails clearly
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.

### 3. Tessera DEX Encoder

Phase 3 adds the first real Go DEX encoder behind the portable DEX port.

#### In Scope

- Add a Go DEX package or builder subpackage for Tessera.
- Embed or define the Tessera ABI needed for
  `tesseraSwapWithAllowances`.
- Add Base and BSC config:
  `0x55555522005bcae1c2424d474bfd5ed477749e3e`.
- Implement `NeedWrapNative` as static `true`.
- Implement `GetDexParam`.

Tessera encoding rules:

- encode:
  `tesseraSwapWithAllowances(tokenIn, tokenOut, amountSpecified, amountCheck, recipient, 0x)`
- native token inputs/outputs are wrapped to the network wrapped-native token
- SELL:
  - `amountSpecified = srcAmount`
  - `amountCheck = 0`
- BUY:
  - `amountSpecified = -destAmount`
  - `amountCheck = srcAmount`

When converting Tessera's builder-local output into
`resolved.DexExchangeBuildParam`, set `NeedWrapNative` to
`resolved.RawBool{Value: true, Valid: true, Present: true}`. Do not construct a
resolved param with a zero-value `RawBool`.

#### Out Of Scope

- No full public-route Tessera parity yet; that is Phase 4.
- No HTTP endpoint adapter implementation.
- No other DEX encoders.

#### Acceptance

- Tessera `GetDexParam` matches TypeScript exchange data and metadata for:
  - SELL
  - BUY
  - native source
  - native destination
  - Base
  - BSC
- Unsupported Tessera network fails clearly.
- Go tests use TypeScript-generated Tessera DEX-param fixtures, not Go-only
  golden vectors.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.

### 4. Full Tessera Public Builder Parity

Phase 4 wires the real Tessera encoder into the public builder and proves full
route encoding parity.

#### In Scope

- Register Tessera in a real Go `DexRegistry`.
- Run the public builder against TypeScript-generated Tessera public fixtures.
- Compare:
  - public request defaults
  - observed resolved `BuildInput`
  - `params`
  - `txObject`
- Fill any remaining resolved/executor gaps exposed by Tessera fixtures. In
  particular, if Tessera BUY/native routes expose Executor03 WETH-plan behavior
  not yet implemented in the resolved encoder, land that support under this
  phase with fixture coverage.

Fixture coverage mirrors `src/dex/tessera/tessera-e2e.test.ts`:

- Base:
  - USDC -> WETH
  - USDC -> ETH
  - WETH -> USDC
  - ETH -> USDC
  - USDC -> WETH BUY
  - USDC -> ETH BUY
- BSC:
  - WBNB -> USDT
  - BNB -> USDT
  - USDT -> WBNB
  - USDT -> BNB
  - WBNB -> USDT BUY
  - BNB -> USDT BUY

Each fixture stores:

- public `BuildRequest`
- observed TypeScript `resolved.BuildInput`
- expected `params`
- expected `txObject`

Use fixed UUID, user address, fee params, gas, permit, and min/max amounts so
fixture output is deterministic.

#### Out Of Scope

- No Tenderly simulation from Go.
- No direct public builder path.
- No runtime TypeScript path replacement.
- No HTTP endpoint adapter implementation unless needed only as a test double.

#### Acceptance

- Go public builder with real Tessera encoder matches TypeScript resolved
  input, `params`, and `txObject` byte-for-byte for all Tessera fixtures.
- Byte-for-byte public parity means:
  - `params` deep equality after JSON-shaped normalization
  - `txObject.from`, `to`, and `data` exact lowercase `0x` hex equality
  - `txObject.value` exact decimal-string equality
  - optional gas fields exact decimal-string equality when present
- Unsupported DEX and unsupported chain fail before resolved encoding.
- Existing resolved generic tests continue passing.
- `go test ./go/...`
- `go vet ./go/...`
- `gofmt -s -l go/` produces no output.
- `yarn fixtures:check`
- `yarn jest tests/generic-swap-transaction-builder/resolved --runInBand`

### 5. Service Adapter Follow-Up

Phase 5 is a planning handoff, not required for Tessera parity.

#### In Scope

- Document final public builder API and port types.
- Document how the future Go API service should satisfy `DexRegistry` with
  in-process Go DEX encoders.
- Document how a temporary HTTP adapter would map `DexParamInput` to
  `tmp/DEX-PARAM-API.md`.
- Decide whether the HTTP adapter belongs in this repo or only in the service
  repo.

#### Out Of Scope

- No TypeScript runtime path replacement.
- No child-process, WASM, native-addon, or service bridge.
- No direct public builder implementation.
- No npm packaging changes for Go artifacts.

## Tooling And Gates

Every phase that changes Go code must pass:

```bash
go test ./go/...
go vet ./go/...
gofmt -s -l go/
```

Every phase that changes fixtures or TypeScript fixture generation must pass:

```bash
yarn fixtures:check
yarn jest tests/generic-swap-transaction-builder/resolved --runInBand
```

## Estimates

- Phase 1: 1-2 days, mostly fixture contract and DTO review.
- Phase 2: 2-4 days, depending on orchestration helper churn.
- Phase 3: 1 day for Tessera encoder and unit parity.
- Phase 4: 1-3 days, depending on Executor03 WETH-plan gaps exposed by BUY
  native Tessera fixtures.
- Phase 5: 0.5-1 day of follow-up documentation.

Total expected implementation size: about 1-2 focused weeks.

## Assumptions

- This plan covers generic-route public builds only.
- Direct public preprocessing remains later.
- The future Go API service will satisfy DEX encoder interfaces in-process.
- The DEX param endpoint contract is useful as a wire-compatible adapter
  contract, but the builder core must remain interface-driven and portable.
- Tessera is the first full-route proof that Go can plan, preprocess, encode
  DEX params, and produce the same Augustus transaction as TypeScript.
- No TypeScript runtime path replacement or TS-to-Go bridge is included in this
  plan.
