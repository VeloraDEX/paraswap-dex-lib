package executor

import (
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/executortest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestExecutor02Constants(t *testing.T) {
	if notExistingExchangeParamIndex != -1 {
		t.Fatalf("sentinel mismatch: got %d want -1", notExistingExchangeParamIndex)
	}
	if swapExchange100Percentage != 100 {
		t.Fatalf("percentage sentinel mismatch: got %d want 100", swapExchange100Percentage)
	}
	if ethSrcTokenPosForMultiswapMetadata != "0xeeeeeeeeeeeeeeee" {
		t.Fatalf("ETH metadata sentinel mismatch: got %s", ethSrcTokenPosForMultiswapMetadata)
	}
	if specialDexExecuteVerticalBranching != 10 {
		t.Fatalf("vertical branching special dex mismatch: got %d want 10", specialDexExecuteVerticalBranching)
	}
}

func TestExecutor02AddMultiSwapMetadata(t *testing.T) {
	builder := NewExecutor02Builder(resolved.EncodingContext{
		WrappedNativeTokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
	})
	srcToken := resolved.Address("0xdac17f958d2ee523a2206206994597c13d831ec7")
	swap := resolved.RoutePlanSwap{
		SrcToken:  srcToken,
		DestToken: "0x6b175474e89094c44da98b954eedeac495271d0f",
		SwapExchanges: []resolved.RoutePlanSwapExchange{
			{Percent: 50, SrcAmount: "1", DestAmount: "1"},
		},
	}
	priceRoute := executorRoute{
		BestRoute: []resolved.RoutePlanRoute{{Percent: 100, Swaps: []resolved.RoutePlanSwap{swap}}},
		SrcToken:  srcToken,
		DestToken: swap.DestToken,
	}
	exchangeParams := []resolved.DexExchangeBuildParam{{
		NeedWrapNative: resolved.RawBool{Present: true, Valid: true, Value: false},
	}}
	callData := resolved.HexBytes(
		"0x12345678" +
			strings.TrimPrefix(zeroBytes(12), "0x") +
			strings.TrimPrefix(string(srcToken), "0x") +
			"abcd",
	)

	got, err := builder.addMultiSwapMetadata(
		priceRoute,
		exchangeParams,
		callData,
		50,
		swap,
		0,
		0,
		notExistingExchangeParamIndex,
		false,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	want := resolved.HexBytes(
		"0x00000000000000000000000000000026" +
			"0000000000000010" +
			"0000000000001388" +
			strings.TrimPrefix(string(callData), "0x"),
	)
	if got != want {
		t.Fatalf("metadata mismatch:\n got: %s\nwant: %s", got, want)
	}

	swap.SrcToken = resolved.NativeTokenAddress
	got, err = builder.addMultiSwapMetadata(
		priceRoute,
		exchangeParams,
		callData,
		91,
		swap,
		0,
		0,
		notExistingExchangeParamIndex,
		false,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	want = resolved.HexBytes(
		"0x00000000000000000000000000000026" +
			strings.TrimPrefix(ethSrcTokenPosForMultiswapMetadata, "0x") +
			"000000000000238c" +
			strings.TrimPrefix(string(callData), "0x"),
	)
	if got != want {
		t.Fatalf("ETH metadata mismatch:\n got: %s\nwant: %s", got, want)
	}

	got, err = builder.addMultiSwapMetadata(
		priceRoute,
		exchangeParams,
		callData,
		swapExchange100Percentage,
		swap,
		0,
		0,
		notExistingExchangeParamIndex,
		false,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	want = resolved.HexBytes(
		"0x00000000000000000000000000000026" +
			strings.TrimPrefix(zeroBytes(8), "0x") +
			"0000000000002710" +
			strings.TrimPrefix(string(callData), "0x"),
	)
	if got != want {
		t.Fatalf("100 percent metadata mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestExecutor02PackVerticalBranchingData(t *testing.T) {
	builder := NewExecutor02Builder(resolved.EncodingContext{})
	got, err := builder.packVerticalBranchingData("0xabcdef")
	if err != nil {
		t.Fatal(err)
	}
	want := resolved.HexBytes(
		"0x" +
			strings.TrimPrefix(zeroBytes(28), "0x") +
			strings.TrimPrefix(zeroBytes(4), "0x") +
			"0000000000000000000000000000000000000000000000000000000000000020" +
			"0000000000000000000000000000000000000000000000000000000000000003" +
			"abcdef",
	)
	if got != want {
		t.Fatalf("vertical branching data mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestExecutor02BuildBytecodeMatchesPhase2cFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"executor02-vertical-branch-sell",
		"executor02-multiswap-sell",
		"executor02-megaswap-sell",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			input, expectedParams := executortest.LoadBuildInputWithExpectedParams(t, fixtureName)
			expectedBytecode := executortest.ExpectedBytecode(t, expectedParams)

			deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
			if err != nil {
				t.Fatal(err)
			}
			builder := NewExecutor02Builder(deps.EncodingContext)

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

func TestExecutor02RejectsPhase2cOutOfScopeBranches(t *testing.T) {
	input, _ := executortest.LoadBuildInputWithExpectedParams(t, "executor02-vertical-branch-sell")
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewExecutor02Builder(deps.EncodingContext)

	for _, testCase := range []struct {
		name   string
		mutate func(*resolved.ExecutorBytecodeBuildInput)
		want   string
	}{
		{
			name: "need unwrap native",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.NeedUnwrapNative = &value
			},
			want: "Executor02 needUnwrapNative is not implemented in Phase 2c",
		},
		{
			name: "custom weth address",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x3333333333333333333333333333333333333333")
				input.ResolvedLegs[0].ExchangeParam.WethAddress = &value
			},
			want: "Executor02 custom wethAddress is not implemented in Phase 2c",
		},
		{
			name: "transfer source token before swap",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x4444444444444444444444444444444444444444")
				input.ResolvedLegs[0].ExchangeParam.TransferSrcTokenBeforeSwap = &value
			},
			want: "Executor02 transferSrcTokenBeforeSwap calldata is not implemented in Phase 2c",
		},
		{
			name: "spender override",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := resolved.Address("0x5555555555555555555555555555555555555555")
				input.ResolvedLegs[0].ExchangeParam.Spender = &value
			},
			want: "Executor02 spender override is not implemented in Phase 2c",
		},
		{
			name: "send eth with insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SendEthButSupportsInsertFromAmount = &value
			},
			want: "Executor02 sendEthButSupportsInsertFromAmount is not implemented in Phase 2c",
		},
		{
			name: "special dex insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SpecialDexSupportsInsertFromAmount = &value
			},
			want: "Executor02 special-dex insert support is not implemented in Phase 2c",
		},
		{
			name: "swapped amount absent",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SwappedAmountNotPresentInExchangeData = &value
			},
			want: "Executor02 swappedAmountNotPresentInExchangeData is not implemented in Phase 2c",
		},
		{
			name: "return amount position",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := 32
				input.ResolvedLegs[0].ExchangeParam.ReturnAmountPos = &value
			},
			want: "Executor02 returnAmountPos override is not implemented in Phase 2c",
		},
		{
			name: "insert from amount position",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := 4
				input.ResolvedLegs[0].ExchangeParam.InsertFromAmountPos = &value
			},
			want: "Executor02 insertFromAmountPos override is not implemented in Phase 2c",
		},
		{
			name: "packed amounts",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.AmountsPacked128 = &value
			},
			want: "Executor02 amountsPacked128 is not implemented in Phase 2c",
		},
		{
			name: "permit2",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.Permit2Approval = &value
			},
			want: "Executor02 permit2Approval is not implemented in Phase 2c",
		},
		{
			name: "skip approval",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SkipApproval = &value
			},
			want: "Executor02 skipApproval is not implemented in Phase 2c",
		},
		{
			name: "approve data",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.ApproveData = &resolved.ApproveData{
					Target: "0x2222222222222222222222222222222222222222",
					Token:  input.SrcToken,
				}
			},
			want: "Executor02 approve calldata is not implemented in Phase 2c",
		},
		{
			name: "special dex flag",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := int(specialDexSwapOnBalancerV1)
				input.ResolvedLegs[0].ExchangeParam.SpecialDexFlag = &value
			},
			want: "Executor02 specialDexFlag is not implemented in Phase 2c",
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

func TestExecutor02RejectsSameTokenPhase2eFixture(t *testing.T) {
	input, _ := executortest.LoadBuildInputWithExpectedParams(t, "same-token-internal-split")
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewExecutor02Builder(deps.EncodingContext)

	_, err = builder.BuildBytecode(executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
	if err == nil || err.Error() != "Executor02 same-token routes are not implemented in Phase 2c" {
		t.Fatalf("unexpected error:\n got: %v\nwant: %s", err, "Executor02 same-token routes are not implemented in Phase 2c")
	}
}
