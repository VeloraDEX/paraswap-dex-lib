package executor

import (
	"reflect"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/executortest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestFlagAndSpecialDexConstants(t *testing.T) {
	if insertFromAmountDontCheckBalanceAfterSwap != 3 {
		t.Fatalf("flag mismatch: got %d want 3", insertFromAmountDontCheckBalanceAfterSwap)
	}
	if sendEthEqualToFromAmountDontCheckBalanceAfterSwap != 9 {
		t.Fatalf("flag mismatch: got %d want 9", sendEthEqualToFromAmountDontCheckBalanceAfterSwap)
	}
	if insertFromAmountCheckSrcTokenBalanceAfterSwap != 11 {
		t.Fatalf("flag mismatch: got %d want 11", insertFromAmountCheckSrcTokenBalanceAfterSwap)
	}
	if specialDexDefault != 0 {
		t.Fatalf("special dex mismatch: got %d want 0", specialDexDefault)
	}
	if specialDexSendNative != 4 {
		t.Fatalf("special dex mismatch: got %d want 4", specialDexSendNative)
	}
}

func TestFindAmountPosInCalldata(t *testing.T) {
	encodedAmount, err := encodeUint256Decimal("1000000")
	if err != nil {
		t.Fatal(err)
	}
	exchangeData := resolved.HexBytes(
		"0xc04b8d59" +
			"0000000000000000000000000000000000000000000000000000000000000020" +
			"000000000000000000000000000000000000000000000000000000000000000a" +
			"000000000000000000000000e6f1c1f58e34df3892cb1b1c193f82462bc0a86e" +
			"0000000000000000000000000000000000000000000000000000000065897370" +
			strings.TrimPrefix(encodedAmount, "0x"),
	)

	got := findAmountPosInCalldata(exchangeData, encodedAmount)
	if got != 132 {
		t.Fatalf("amount position mismatch: got %d want 132", got)
	}
}

func TestFindAmountPosInCalldataFallbackUsesOriginalHexStringLength(t *testing.T) {
	got := findAmountPosInCalldata(
		resolved.HexBytes("0x12345678"),
		"0x000000000000000000000000000000000000000000000000000000000000002a",
	)
	if got != 5 {
		t.Fatalf("fallback amount position mismatch: got %d want 5", got)
	}
}

func TestBuildExecutor0102CallDataLayout(t *testing.T) {
	calldata := resolved.HexBytes("0xabcdef12")
	got, err := buildExecutor0102CallData(
		"0x1111111111111111111111111111111111111111",
		calldata,
		4,
		68,
		specialDexDefault,
		insertFromAmountDontCheckBalanceAfterSwap,
		defaultReturnAmountPos,
	)
	if err != nil {
		t.Fatal(err)
	}

	want := resolved.HexBytes(
		"0x1111111111111111111111111111111111111111" +
			"00000020" +
			"0004" +
			"0044" +
			"ff" +
			"00" +
			"0003" +
			"00000000000000000000000000000000000000000000000000000000" +
			"abcdef12",
	)
	if got != want {
		t.Fatalf("call-data layout mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestExecutor01BuildBytecodeMatchesPhase2eFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"edge-nonempty-permit",
		"edge-zero-quoted-amount",
		"executor01-eth-weth-deposit",
		"executor01-simple-sell-approved",
		"executor01-simple-sell-approval-missing",
		"executor01-simple-sell-beneficiary",
		"executor01-multiswap-sell",
		"executor01-weth-eth-withdraw",
		"fee-direct-transfer",
		"fee-nonzero-partner",
		"fee-referrer",
		"fee-surplus-to-user",
		"fee-take-surplus",
		"need-unwrap-native",
		"permit2-approval",
		"transfer-src-token-before-swap",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			input, expectedParams := executortest.LoadBuildInputWithExpectedParams(t, fixtureName)
			expectedBytecode := executortest.ExpectedBytecode(t, expectedParams)

			deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
			if err != nil {
				t.Fatal(err)
			}
			builder := NewExecutor01Builder(deps.EncodingContext)

			got, err := builder.BuildBytecode(executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
			if err != nil {
				t.Fatal(err)
			}
			if got != expectedBytecode {
				t.Fatalf("bytecode mismatch:\n got: %s\nwant: %s", got, expectedBytecode)
			}
		})
	}
}

func TestExecutor01DestTokenPositionUsesNormalizedAddress(t *testing.T) {
	input, expectedParams := executortest.LoadBuildInputWithExpectedParams(t, "executor01-multiswap-sell")
	expectedBytecode := executortest.ExpectedBytecode(t, expectedParams)
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	deps.EncodingContext.WrappedNativeTokenAddress = "0xC02aaa39B223FE8D0A0e5C4F27eAD9083C756Cc2"
	builder := NewExecutor01Builder(deps.EncodingContext)

	got, err := builder.BuildBytecode(executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
	if err != nil {
		t.Fatal(err)
	}
	if got != expectedBytecode {
		t.Fatalf("bytecode mismatch:\n got: %s\nwant: %s", got, expectedBytecode)
	}
}

func TestExecutor01RejectsPhase2eOutOfScopeBranches(t *testing.T) {
	input, _ := executortest.LoadBuildInputWithExpectedParams(t, "executor01-simple-sell-approved")
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewExecutor01Builder(deps.EncodingContext)

	for _, testCase := range []struct {
		name   string
		mutate func(*resolved.ExecutorBytecodeBuildInput)
		want   string
	}{
		{
			name: "needWrapNative false",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.NeedWrapNative.Value = false
			},
			want: "Executor01 needWrapNative=false is not implemented in Phase 2e",
		},
		{
			name: "no recipient dex",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.DexFuncHasRecipient = false
			},
			want: "Executor01 dexFuncHasRecipient=false is not implemented in Phase 2e",
		},
		{
			name: "WETH destination need unwrap native",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.NeedUnwrapNative = &value
				input.RoutePlan.Routes[0].Swaps[0].DestToken = deps.EncodingContext.WrappedNativeTokenAddress
			},
			want: "Executor01 WETH-destination needUnwrapNative is not implemented in Phase 2e",
		},
		{
			name: "send eth insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SendEthButSupportsInsertFromAmount = &value
			},
			want: "Executor01 sendEthButSupportsInsertFromAmount is not implemented in Phase 2e",
		},
		{
			name: "custom weth without need unwrap",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x3333333333333333333333333333333333333333")
				input.ResolvedLegs[0].ExchangeParam.WethAddress = &value
			},
			want: "Executor01 custom wethAddress is not implemented in Phase 2e",
		},
		{
			name: "custom weth with source need unwrap",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.NeedUnwrapNative = &value
				input.RoutePlan.Routes[0].Swaps[0].SrcToken = deps.EncodingContext.WrappedNativeTokenAddress
				customWeth := resolved.Address("0x3333333333333333333333333333333333333333")
				input.ResolvedLegs[0].ExchangeParam.WethAddress = &customWeth
			},
			want: "Executor01 custom wethAddress is not implemented in Phase 2e",
		},
		{
			name: "spender override",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x5555555555555555555555555555555555555555")
				input.ResolvedLegs[0].ExchangeParam.Spender = &value
			},
			want: "Executor01 spender override is not implemented in Phase 2e",
		},
		{
			name: "special dex insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SpecialDexSupportsInsertFromAmount = &value
			},
			want: "Executor01 special-dex insert support is not implemented in Phase 2e",
		},
		{
			name: "swapped amount absent",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SwappedAmountNotPresentInExchangeData = &value
			},
			want: "Executor01 swappedAmountNotPresentInExchangeData is not implemented in Phase 2e",
		},
		{
			name: "return amount position",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := 32
				input.ResolvedLegs[0].ExchangeParam.ReturnAmountPos = &value
			},
			want: "Executor01 returnAmountPos override is not implemented in Phase 2e",
		},
		{
			name: "insert from amount position",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := 4
				input.ResolvedLegs[0].ExchangeParam.InsertFromAmountPos = &value
			},
			want: "Executor01 insertFromAmountPos override is not implemented in Phase 2e",
		},
		{
			name: "packed amounts",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.AmountsPacked128 = &value
			},
			want: "Executor01 amountsPacked128 is not implemented in Phase 2e",
		},
		{
			name: "skip approval",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SkipApproval = &value
			},
			want: "Executor01 skipApproval is not implemented in Phase 2e",
		},
		{
			name: "special dex flag",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := int(specialDexSwapOnBalancerV1)
				input.ResolvedLegs[0].ExchangeParam.SpecialDexFlag = &value
			},
			want: "Executor01 specialDexFlag is not implemented in Phase 2e",
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

func TestFactoryCreatesRegisteredExecutors(t *testing.T) {
	input, _ := executortest.LoadBuildInputWithExpectedParams(t, "executor01-simple-sell-approved")
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}

	factory := NewFactory()
	builder, err := factory.CreateExecutorBytecodeBuilder(resolved.Executor01, deps.EncodingContext)
	if err != nil {
		t.Fatal(err)
	}
	if builder == nil {
		t.Fatal("expected Executor01 builder")
	}

	builder, err = factory.CreateExecutorBytecodeBuilder(resolved.Executor02, deps.EncodingContext)
	if err != nil {
		t.Fatal(err)
	}
	if builder == nil {
		t.Fatal("expected Executor02 builder")
	}

	builder, err = factory.CreateExecutorBytecodeBuilder(resolved.Executor03, deps.EncodingContext)
	if err != nil {
		t.Fatal(err)
	}
	if builder == nil {
		t.Fatal("expected Executor03 builder")
	}

	builder, err = factory.CreateExecutorBytecodeBuilder(resolved.ExecutorWETH, deps.EncodingContext)
	if err != nil {
		t.Fatal(err)
	}
	if builder == nil {
		t.Fatal("expected WETH builder")
	}
}

func TestGetExchangeParamsWalksRoutePlanOrder(t *testing.T) {
	input, _ := executortest.LoadBuildInputWithExpectedParams(t, "executor01-multiswap-sell")
	buildInput := executortest.ParseExpectedBytecodeBuildInput(t, input, resolved.EncodingContext{})
	reversed := append([]resolved.ResolvedLeg(nil), buildInput.ResolvedLegs...)
	reversed[0], reversed[1] = reversed[1], reversed[0]
	buildInput.ResolvedLegs = reversed

	got, err := getExchangeParams(buildInput)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("exchange param count mismatch: got %d want 2", len(got))
	}
	if !reflect.DeepEqual(got[0], buildInput.ResolvedLegs[1].ExchangeParam) {
		t.Fatal("first exchange param did not follow route-plan order")
	}
	if !reflect.DeepEqual(got[1], buildInput.ResolvedLegs[0].ExchangeParam) {
		t.Fatal("second exchange param did not follow route-plan order")
	}
}
