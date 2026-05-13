# Go Build Transaction Boundary: High-Level Implementation

## Objective

Introduce a TypeScript-only resolved build boundary that can later be ported to Go without changing behavior. The boundary takes a serializable `BuildInput`, uses an explicit `RoutePlan` plus fully resolved `ResolvedLeg[]`, and returns the same V6 `TxObject` currently produced by `GenericSwapTransactionBuilder.build()`.

The first implementation should preserve the public builder API and keep all DEX lookup, remote DEX params, WETH decisioning, and approval checks outside the resolved boundary.

## Implementation Phases

### 1. Add Boundary Types

Create a new resolved-build module, for example:

```text
src/generic-swap-transaction-builder/resolved/
```

Define serializable types:

```ts
type BuildInput = {
  routePlan: RoutePlan;
  resolvedLegs: ResolvedLeg[];
  wethPlan?: DepositWithdrawReturn;
  executorType: Executors;
  executorAddress: Address;
  augustusV6Address: Address;
  wrappedNativeTokenAddress: Address;
  network: number;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  minMaxAmount: string;
  quotedAmount: string;
  side: SwapSide;
  contractMethod: ContractMethodV6;
  blockNumber: number;
  userAddress: Address;
  beneficiary: Address;
  permit: string;
  uuid: string;
  fee: FeeInput;
  gas?: GasInput;
};
```

`RoutePlan` should preserve the original route tree:

```ts
type RoutePlan = {
  routes: RoutePlanRoute[];
};

type RoutePlanRoute = {
  percent: number;
  swaps: RoutePlanSwap[];
};

type RoutePlanSwap = {
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  swapExchanges: RoutePlanSwapExchange[];
};

type RoutePlanSwapExchange = {
  exchange: string;
  percent: number;
  srcAmount: string;
  destAmount: string;
};
```

`ResolvedLeg` should be keyed by route position and contain already normalized params:

```ts
type ResolvedLeg = {
  routeIndex: number;
  swapIndex: number;
  swapExchangeIndex: number;
  exchangeParam: DexExchangeBuildParam & { needWrapNative: boolean };
  normalizedSrcToken: Address;
  normalizedDestToken: Address;
  normalizedSrcAmount: string;
  normalizedDestAmount: string;
  recipient: Address;
};
```

### 2. Extract Orchestration From `GenericSwapTransactionBuilder`

Keep `GenericSwapTransactionBuilder.build()` as the public entrypoint, but split it into two layers:

- orchestration layer:
  - normalizes `quotedAmount`, `beneficiary`, `permit`, and fee defaults
  - selects `executorType` and `executorAddress`
  - converts `priceRoute` to `RoutePlan`
  - resolves each DEX param
  - resolves function-typed `needWrapNative` to boolean
  - computes `wethPlan`
  - injects `approveData`
  - calls the resolved boundary
- resolved boundary:
  - validates serialized input
  - builds executor bytecode
  - packs partner-and-fee
  - encodes Augustus V6 calldata
  - returns `TxObject`

Do not change callers. `onlyParams` should remain supported by the wrapper by returning the resolved boundary's encoded params before `TxObject` assembly.

### 3. Build a Pure Encoding Context

Current executor builders depend on `IDexHelper` for config and small helpers. For the boundary, introduce a minimal encoding context instead of passing `DexAdapterService` or RPC-backed helpers.

The context needs only:

- `network`
- `augustusV6Address`
- `wrappedNativeTokenAddress`
- `executorsAddresses`
- `isWETH(address)`
- a logger or no-op logger for warnings such as amount-position fallback

Use this context to instantiate or adapt `Executor01BytecodeBuilder`, `Executor02BytecodeBuilder`, `Executor03BytecodeBuilder`, and `WETHBytecodeBuilder`. This keeps the first refactor low risk while removing runtime DEX/service dependencies from the future Go boundary.

### 4. Implement Generic Resolved Build

Add:

```ts
buildTransactionFromResolved(input: BuildInput): TxObject
```

Implementation flow:

1. Validate `BuildInput` invariants.
2. Build a map from `(routeIndex, swapIndex, swapExchangeIndex)` to `ResolvedLeg`.
3. Reconstruct the executor-facing route shape from `RoutePlan`.
4. Reconstruct executor `exchangeParams` by walking `RoutePlan` in nested order and reading each matching `ResolvedLeg.exchangeParam`.
5. Instantiate the executor bytecode builder from `input.executorType`.
6. Build executor bytecode using `routePlan`, `exchangeParams`, `userAddress`, and `wethPlan`.
7. Pack `partnerAndFee`.
8. Encode Augustus V6 function data for generic methods:
   - `swapExactAmountIn`
   - `swapExactAmountOut`
   - `swapExactAmountInPro`
   - `swapExactAmountOutPro`
9. Compute `value` from `srcToken`, `side`, `srcAmount`, and `minMaxAmount`.
10. Return `TxObject`.

The boundary must not:

- call `getTxBuilderDexByKey`
- call remote DEX param APIs
- call `augustusApprovals.hasApprovals`
- inspect mutable `newDexs`
- evaluate function-typed `needWrapNative`
- infer executor type from the route

### 5. Implement Direct Resolved Build

Add:

```ts
buildDirectTransactionFromResolved(input: DirectBuildInput): TxObject
```

This path should not try to force direct swaps into `ResolvedLeg[]`. Direct DEX-specific param construction stays outside the boundary. The resolved direct input should contain:

- `contractMethod`
- `params`
- `userAddress`
- `augustusV6Address`
- `srcToken`
- `srcAmount`
- `minMaxAmount`
- `side`
- optional gas fields

Direct methods covered by this path are the current `isDirectFunctionNameV6` methods:

- UniswapV2 in/out
- UniswapV3 in/out
- BalancerV2 in/out
- CurveV1 in
- CurveV2 in
- `swapExactAmountInOutOnMakerPSM`
- `swapOnAugustusRFQTryBatchFill`

Generic methods, including `swapExactAmountInPro` and `swapExactAmountOutPro`, remain on `buildTransactionFromResolved`.

### 6. Add Input Validation

Add explicit validation near the boundary so bugs fail before encoding:

- all amounts are decimal strings in wei
- addresses are lowercase 42-character hex
- bytes fields are `0x`-prefixed hex
- `needWrapNative` is boolean on every `ResolvedLeg.exchangeParam`
- every route exchange has exactly one matching `ResolvedLeg`
- no duplicate `ResolvedLeg` route position exists
- `executorType` is one of `WETH`, `Executor01`, `Executor02`, `Executor03`
- `contractMethod` is supported by the selected boundary path

Use direct error messages that map cleanly to Go errors.

### 7. Add Fixture Generation and Parity Tests

Add golden fixtures under the plan-specific fixture area or a test fixture directory with this shape:

```json
{
  "input": {},
  "expectedTx": {}
}
```

Fixtures must be RPC-free. Use explicit precomputed approval decisions rather than chain state. Cover both approval-missing and already-approved scenarios; `skipApprovalCheck` alone is not enough because it only forces approval-missing behavior.

Parity tests:

- old `GenericSwapTransactionBuilder.build()` output equals `buildTransactionFromResolved(input)`
- old direct path output equals `buildDirectTransactionFromResolved(input)`
- existing Executor01/02/03 snapshot tests still pass

Required generic scenarios:

- Executor01 simple SELL
- Executor01 multiswap SELL
- Executor02 vertical branch SELL
- Executor02 mega swap SELL
- Executor03 BUY
- WETH-only route
- same-token-pair internal split
- ETH/WETH deposit and withdraw
- `permit2Approval`
- `transferSrcTokenBeforeSwap`
- `needUnwrapNative`

### 8. Migration Checkpoints

Recommended checkpoint order:

1. Add types and conversion helpers without changing build behavior.
2. Add resolved boundary behind existing `build()` and assert parity for one simple fixture.
3. Expand parity to Executor01, Executor02, Executor03, and WETH.
4. Add direct boundary parity.
5. Generate complete golden fixtures.
6. Use the fixture JSON as the contract for the Go implementation.

## Non-Goals For This Step

- Do not add a Go module yet.
- Do not port DEX-specific `getDexParam` or `getDirectParamV6` implementations.
- Do not change public SDK/build APIs.
- Do not change route pricing or preprocessing behavior.
- Do not change executor bytecode semantics.
