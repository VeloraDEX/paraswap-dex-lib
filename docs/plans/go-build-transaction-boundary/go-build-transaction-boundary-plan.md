# Go-Shaped V6 Build Boundary

## Summary

Create a TypeScript boundary that mirrors the future Go entrypoint, while preserving the route tree needed by Executor01/02/03:

```go
BuildTransaction(input BuildInput) (TxObject, error)
```

`BuildInput` contains both a Go-friendly `RoutePlan` and fully resolved swap-exchange data. This first deliverable is TypeScript-only. It keeps `GenericSwapTransactionBuilder.build()` behavior unchanged, but moves final V6 transaction assembly into a pure, serializable API.

## Key Changes

- Add a pure resolved-build module exposing:
  ```ts
  buildTransactionFromResolved(input: BuildInput): TxObject
  buildDirectTransactionFromResolved(input: DirectBuildInput): TxObject
  ```
- Define `RoutePlan` from `priceRoute`, preserving nesting:
  - `routes[]` for mega-swap branches
  - `route.swaps[]` for ordered multi-swap steps
  - `swap.swapExchanges[]` for parallel/internal splits on the same token pair
- Define `ResolvedLeg` keyed by route position:
  ```ts
  {
    routeIndex: number;
    swapIndex: number;
    swapExchangeIndex: number;
    exchangeParam: DexExchangeBuildParam;
    normalizedSrcToken: Address;
    normalizedDestToken: Address;
    normalizedSrcAmount: string;
    normalizedDestAmount: string;
    recipient: Address;
  }
  ```
- Do not infer execution shape from flat leg order. Executor selection and encoding use `RoutePlan`; resolved params are looked up by `(routeIndex, swapIndex, swapExchangeIndex)`.
- Keep direct methods separate:
  - generic executor path uses `RoutePlan + ResolvedLeg[]`
  - direct path uses `ResolvedDirectCall { contractMethod, params }`
  - direct DEX-specific param construction remains outside this boundary

## Implementation Shape

- Refactor `GenericSwapTransactionBuilder.build()` into orchestration:
  1. normalize quoted amount and beneficiary
  2. select executor and execution address
  3. convert `priceRoute` to `RoutePlan`
  4. resolve each DEX param
  5. compute WETH plan
  6. attach approval data
  7. call `buildTransactionFromResolved`
- Move pure logic into the resolved boundary:
  - partner-and-fee packing
  - Augustus V6 generic call params
  - transaction `value`
  - executor bytecode encoding from `RoutePlan + ResolvedLeg[]`
- Preserve existing public API:
  - no caller changes
  - `onlyParams` remains supported by the wrapper
  - `skipApprovalCheck`, remote DEX params, approval checking, and DEX lookup stay outside the pure boundary

## Test Plan

- Add golden fixtures containing `{ input, expectedTx }`.
- Cover:
  - Executor01 simple and multiswap SELL
  - Executor02 vertical branch and mega swap SELL
  - Executor03 BUY
  - same token-pair internal swap-exchange splits
  - ETH/WETH deposit and withdraw cases
  - approval missing vs already approved
  - `permit2Approval`
  - `transferSrcTokenBeforeSwap`
  - `needUnwrapNative`
- Add parity tests:
  - old `GenericSwapTransactionBuilder.build()` output equals resolved-boundary output
  - existing executor snapshot tests still pass unchanged
  - direct boundary parity for one UniswapV2/V3-style direct method and one RFQ-style direct method

## Assumptions

- First deliverable is TypeScript boundary only; no Go module is added yet.
- `BuildInput` is serializable and includes `RoutePlan`, `ResolvedLeg[]`, WETH plan, fee input, addresses, permit, uuid, gas fields, and amount fields.
- `ResolvedLeg[]` is fully resolved before the boundary: no DEX lookup, HTTP, WETH decisioning, or approval checking inside `buildTransactionFromResolved`.
- Future Go implementation consumes the same JSON shape and compares final `tx.data` byte-for-byte against TypeScript fixtures.

## Validated Clarifications

These points are implementation requirements, not open questions.

1. **Serialization invariants for `BuildInput`.** All amounts are decimal strings in wei, all address fields are normalized lowercase 42-character hex, and arbitrary byte fields (`exchangeData`, `permit`, encoded paths) remain hex strings. No function-typed field may cross the boundary. In particular, `DexExchangeParam.needWrapNative` must be resolved to a boolean before a `ResolvedLeg` is created.

2. **`wethPlan` shape.** `BuildInput.wethPlan` is the precomputed `DepositWithdrawReturn` shape (`deposit`/`withdraw` calldata, callee, and value). The boundary must not look up the WETH DEX or rebuild deposit/withdraw calldata (though cna be modified for some cases with manual insert, like with `insertAmountPos`).

3. **Executor is explicit.** The orchestrator selects the executor and passes both `executorType: Executors` and `executorAddress` into `BuildInput`. The boundary uses those fields plus `RoutePlan`; it must not re-run executor detection.

4. **Approval data lives on `ResolvedLeg`.** `ResolvedLeg.exchangeParam` is a `DexExchangeBuildParam` with `needWrapNative: boolean`. Any `approveData` is already injected by the orchestrator. The boundary never calls `augustusApprovals.hasApprovals`.

5. **Contract method routing.** `buildTransactionFromResolved` handles generic V6 methods with generic executor calldata: `swapExactAmountIn`, `swapExactAmountOut`, `swapExactAmountInPro`, and `swapExactAmountOutPro`. `buildDirectTransactionFromResolved` handles direct V6 methods currently detected by `isDirectFunctionNameV6`: UniswapV2 in/out, UniswapV3 in/out, BalancerV2 in/out, CurveV1 in, CurveV2 in, `swapExactAmountInOutOnMakerPSM`, and `swapOnAugustusRFQTryBatchFill`.

6. **Golden fixtures lock outer V6 calldata.** Fixtures must compare the full transaction object, especially outer Augustus V6 `data`: executor address, generic swap tuple, `partnerAndFee`, `quotedAmount`, `uuid`/`blockNumber` metadata, `beneficiary`, `permit`, executor bytecode, and transaction `value`.

7. **Golden fixtures are RPC-free.** Fixture generation must use explicit precomputed approval decisions. The current `skipApprovalCheck` path is deterministic but treats every approval as missing, so it is not enough for "already approved" scenarios.

8. **Boundary error model.** The TypeScript boundary should throw explicit errors that map cleanly to Go errors: unknown executor type, unsupported contract method for the selected path, missing or duplicate `ResolvedLeg` for a route position, malformed `RoutePlan`, non-boolean `needWrapNative`, and invalid serialized address/amount fields.
