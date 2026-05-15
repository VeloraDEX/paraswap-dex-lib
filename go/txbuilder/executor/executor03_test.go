package executor

import (
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/executortest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildExecutor03CallDataLayout(t *testing.T) {
	calldata := resolved.HexBytes("0xabcdef12")
	got, err := buildExecutor03CallData(
		"0x1111111111111111111111111111111111111111",
		calldata,
		4,
		68,
		specialDexDefault,
		insertFromAmountDontCheckBalanceAfterSwap,
		8,
	)
	if err != nil {
		t.Fatal(err)
	}

	want := resolved.HexBytes(
		"0x1111111111111111111111111111111111111111" +
			"0020" +
			"0008" +
			"0004" +
			"0044" +
			"0000" +
			"0003" +
			"00000000000000000000000000000000000000000000000000000000" +
			"abcdef12",
	)
	if got != want {
		t.Fatalf("call-data layout mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestExecutor03OrdersNeedWrapNativeLastAndKeepsOriginalIndex(t *testing.T) {
	builder := NewExecutor03Builder(resolved.EncodingContext{})
	ordered := builder.orderExchanges([]orderedExecutorLeg{
		{
			RoutePlanExchange: resolved.RoutePlanExchange{
				SwapExchangeIndex: 0,
				SwapExchange:      resolved.RoutePlanSwapExchange{SrcAmount: "10"},
			},
			ResolvedLeg: resolved.ResolvedLeg{
				ExchangeParam: resolved.DexExchangeBuildParam{
					NeedWrapNative: resolved.RawBool{Present: true, Valid: true, Value: true},
				},
			},
		},
		{
			RoutePlanExchange: resolved.RoutePlanExchange{
				SwapExchangeIndex: 1,
				SwapExchange:      resolved.RoutePlanSwapExchange{SrcAmount: "20"},
			},
			ResolvedLeg: resolved.ResolvedLeg{
				ExchangeParam: resolved.DexExchangeBuildParam{
					NeedWrapNative: resolved.RawBool{Present: true, Valid: true, Value: false},
				},
			},
		},
	})

	if len(ordered) != 2 {
		t.Fatalf("ordered count mismatch: got %d want 2", len(ordered))
	}
	if ordered[0].swapExchangeIndex != 1 || ordered[0].swapExchange.SrcAmount != "20" {
		t.Fatalf("first ordered exchange mismatch: %#v", ordered[0])
	}
	if ordered[1].swapExchangeIndex != 0 || ordered[1].swapExchange.SrcAmount != "10" {
		t.Fatalf("second ordered exchange mismatch: %#v", ordered[1])
	}
}

func TestExecutor03AddMetadata(t *testing.T) {
	builder := NewExecutor03Builder(resolved.EncodingContext{})
	srcToken := resolved.Address("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")
	destToken := resolved.Address("0xdac17f958d2ee523a2206206994597c13d831ec7")
	callData := resolved.HexBytes(
		"0x12345678" +
			strings.TrimPrefix(zeroBytes(12), "0x") +
			strings.TrimPrefix(string(destToken), "0x") +
			strings.TrimPrefix(zeroBytes(12), "0x") +
			strings.TrimPrefix(string(srcToken), "0x"),
	)

	got, err := builder.addMetadata(callData, 91.25, srcToken, destToken, true)
	if err != nil {
		t.Fatal(err)
	}
	want := resolved.HexBytes(
		"0x00000044" +
			"00000001" +
			"0000000000000010" +
			"0000000000000030" +
			"00000000000023a5" +
			strings.TrimPrefix(string(callData), "0x"),
	)
	if got != want {
		t.Fatalf("metadata mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestExecutor03FindAmountPosWithFallbackFindsNegativeInt256Word(t *testing.T) {
	builder := NewExecutor03Builder(resolved.EncodingContext{})
	negativeEncoded, err := encodeNegativeInt256Decimal("42")
	if err != nil {
		t.Fatal(err)
	}
	exchangeData := resolved.HexBytes(
		"0x12345678" +
			strings.TrimPrefix(negativeEncoded, "0x"),
	)

	got, err := builder.findAmountPosWithFallback(exchangeData, "42")
	if err != nil {
		t.Fatal(err)
	}
	if got != 4 {
		t.Fatalf("negative amount position mismatch: got %d want 4", got)
	}
}

func TestExecutor03BuildBytecodeMatchesPhase2dFixtures(t *testing.T) {
	input, expectedParams := executortest.LoadBuildInputWithExpectedParams(t, "executor03-buy")
	expectedBytecode := executortest.ExpectedBytecode(t, expectedParams)

	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewExecutor03Builder(deps.EncodingContext)

	got, err := builder.BuildBytecode(executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
	if err != nil {
		t.Fatal(err)
	}
	if got != expectedBytecode {
		t.Fatalf("bytecode mismatch:\n got: %s\nwant: %s", got, expectedBytecode)
	}
}

func TestExecutor03RejectsPhase2dOutOfScopeBranches(t *testing.T) {
	input, _ := executortest.LoadBuildInputWithExpectedParams(t, "executor03-buy")
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewExecutor03Builder(deps.EncodingContext)

	for _, testCase := range []struct {
		name   string
		mutate func(*resolved.ExecutorBytecodeBuildInput)
		want   string
	}{
		{
			name: "weth plan",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.WethPlan = &resolved.WethPlan{
					Deposit: &resolved.WethSubPlan{
						Callee:   deps.EncodingContext.WrappedNativeTokenAddress,
						Calldata: "0xd0e30db0",
						Value:    "0",
					},
				}
			},
			want: "Executor03 WETH plan calldata is not implemented in Phase 2d",
		},
		{
			name: "no recipient dex",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.DexFuncHasRecipient = false
			},
			want: "Executor03 dexFuncHasRecipient=false is not implemented in Phase 2d",
		},
		{
			name: "need unwrap native",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.NeedUnwrapNative = &value
			},
			want: "Executor03 needUnwrapNative is not implemented in Phase 2d",
		},
		{
			name: "custom weth address",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x3333333333333333333333333333333333333333")
				input.ResolvedLegs[0].ExchangeParam.WethAddress = &value
			},
			want: "Executor03 custom wethAddress is not implemented in Phase 2d",
		},
		{
			name: "transfer source token before swap",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x4444444444444444444444444444444444444444")
				input.ResolvedLegs[0].ExchangeParam.TransferSrcTokenBeforeSwap = &value
			},
			want: "Executor03 transferSrcTokenBeforeSwap calldata is not implemented in Phase 2d",
		},
		{
			name: "spender override",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x5555555555555555555555555555555555555555")
				input.ResolvedLegs[0].ExchangeParam.Spender = &value
			},
			want: "Executor03 spender override is not implemented in Phase 2d",
		},
		{
			name: "send eth with insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SendEthButSupportsInsertFromAmount = &value
			},
			want: "Executor03 sendEthButSupportsInsertFromAmount is not implemented in Phase 2d",
		},
		{
			name: "special dex insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SpecialDexSupportsInsertFromAmount = &value
			},
			want: "Executor03 special-dex insert support is not implemented in Phase 2d",
		},
		{
			name: "swapped amount absent",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SwappedAmountNotPresentInExchangeData = &value
			},
			want: "Executor03 swappedAmountNotPresentInExchangeData is not implemented in Phase 2d",
		},
		{
			name: "return amount position",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := 32
				input.ResolvedLegs[0].ExchangeParam.ReturnAmountPos = &value
			},
			want: "Executor03 returnAmountPos override is not implemented in Phase 2d",
		},
		{
			name: "insert from amount position",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := 4
				input.ResolvedLegs[0].ExchangeParam.InsertFromAmountPos = &value
			},
			want: "Executor03 insertFromAmountPos override is not implemented in Phase 2d",
		},
		{
			name: "packed amounts",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.AmountsPacked128 = &value
			},
			want: "Executor03 amountsPacked128 is not implemented in Phase 2d",
		},
		{
			name: "permit2",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.Permit2Approval = &value
			},
			want: "Executor03 permit2Approval is not implemented in Phase 2d",
		},
		{
			name: "skip approval",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SkipApproval = &value
			},
			want: "Executor03 skipApproval is not implemented in Phase 2d",
		},
		{
			name: "approve data",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.ApproveData = &resolved.ApproveData{
					Target: "0x2222222222222222222222222222222222222222",
					Token:  input.SrcToken,
				}
			},
			want: "Executor03 approve calldata is not implemented in Phase 2d",
		},
		{
			name: "special dex flag",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := int(specialDexSwapOnBalancerV1)
				input.ResolvedLegs[0].ExchangeParam.SpecialDexFlag = &value
			},
			want: "Executor03 specialDexFlag is not implemented in Phase 2d",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			buildInput := executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext)
			testCase.mutate(&buildInput)

			_, err := builder.BuildBytecode(buildInput)
			if err == nil || err.Error() != testCase.want {
				t.Fatalf("unexpected error:\n got: %v\nwant: %s", err, testCase.want)
			}
		})
	}
}
