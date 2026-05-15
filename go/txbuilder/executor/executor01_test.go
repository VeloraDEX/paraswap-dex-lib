package executor

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
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

func TestExecutor01BuildBytecodeMatchesPhase2bFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-simple-sell-approved",
		"executor01-multiswap-sell",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			input, expectedParams := loadBuildInputWithExpectedParams(t, fixtureName)
			expectedBytecode, ok := expectedParams[4].(string)
			if !ok {
				t.Fatalf("expectedParams[4] is not bytecode string: %#v", expectedParams[4])
			}

			deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
			if err != nil {
				t.Fatal(err)
			}
			builder := NewExecutor01Builder(deps.EncodingContext)

			got, err := builder.BuildBytecode(parseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
			if err != nil {
				t.Fatal(err)
			}
			if got != resolved.HexBytes(expectedBytecode) {
				t.Fatalf("bytecode mismatch:\n got: %s\nwant: %s", got, expectedBytecode)
			}
		})
	}
}

func TestExecutor01DestTokenPositionUsesNormalizedAddress(t *testing.T) {
	input, expectedParams := loadBuildInputWithExpectedParams(t, "executor01-multiswap-sell")
	expectedBytecode := expectedParams[4].(string)
	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	deps.EncodingContext.WrappedNativeTokenAddress = "0xC02aaa39B223FE8D0A0e5C4F27eAD9083C756Cc2"
	builder := NewExecutor01Builder(deps.EncodingContext)

	got, err := builder.BuildBytecode(parseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
	if err != nil {
		t.Fatal(err)
	}
	if got != resolved.HexBytes(expectedBytecode) {
		t.Fatalf("bytecode mismatch:\n got: %s\nwant: %s", got, expectedBytecode)
	}
}

func TestExecutor01RejectsPhase2bOutOfScopeBranches(t *testing.T) {
	input, _ := loadBuildInputWithExpectedParams(t, "executor01-simple-sell-approved")
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
			want: "Executor01 needWrapNative=false is not implemented in Phase 2b",
		},
		{
			name: "no recipient dex",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.DexFuncHasRecipient = false
			},
			want: "Executor01 dexFuncHasRecipient=false is not implemented in Phase 2b",
		},
		{
			name: "need unwrap native",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.NeedUnwrapNative = &value
			},
			want: "Executor01 needUnwrapNative is not implemented in Phase 2b",
		},
		{
			name: "send eth insert support",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := true
				input.ResolvedLegs[0].ExchangeParam.SendEthButSupportsInsertFromAmount = &value
			},
			want: "Executor01 sendEthButSupportsInsertFromAmount is not implemented in Phase 2b",
		},
		{
			name: "special dex flag",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				value := int(specialDexSwapOnBalancerV1)
				input.ResolvedLegs[0].ExchangeParam.SpecialDexFlag = &value
			},
			want: "Executor01 specialDexFlag is not implemented in Phase 2b",
		},
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
			want: "Executor01 WETH plan calldata is not implemented in Phase 2b",
		},
		{
			name: "approval",
			mutate: func(input *resolved.ExecutorBytecodeBuildInput) {
				input.ResolvedLegs[0].ExchangeParam.ApproveData = &resolved.ApproveData{
					Target: "0x2222222222222222222222222222222222222222",
					Token:  input.SrcToken,
				}
			},
			want: "Executor01 approve calldata is not implemented in Phase 2b",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			buildInput := parseExpectedBytecodeBuildInput(t, input, deps.EncodingContext)
			testCase.mutate(&buildInput)

			_, err := builder.BuildBytecode(buildInput)
			if err == nil || err.Error() != testCase.want {
				t.Fatalf("unexpected error:\n got: %v\nwant: %s", err, testCase.want)
			}
		})
	}
}

func TestFactoryCreatesExecutor01Only(t *testing.T) {
	input, _ := loadBuildInputWithExpectedParams(t, "executor01-simple-sell-approved")
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

	_, err = factory.CreateExecutorBytecodeBuilder(resolved.Executor02, deps.EncodingContext)
	if err == nil || err.Error() != "executor type not supported by Go bytecode factory: Executor02" {
		t.Fatalf("unexpected unsupported executor error: %v", err)
	}
}

func TestGetExchangeParamsWalksRoutePlanOrder(t *testing.T) {
	input, _ := loadBuildInputWithExpectedParams(t, "executor01-multiswap-sell")
	buildInput := parseExpectedBytecodeBuildInput(t, input, resolved.EncodingContext{})
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

func loadFixture(t *testing.T, name string) testfixtures.Fixture {
	t.Helper()

	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}
	fixture, ok := collection.FixtureByName(name)
	if !ok {
		t.Fatalf("expected %s fixture", name)
	}
	return fixture
}

func loadBuildInputWithExpectedParams(t *testing.T, name string) (resolved.BuildInput, []any) {
	t.Helper()

	fixture := loadFixture(t, name)
	var input resolved.BuildInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		t.Fatal(err)
	}
	var expectedParams []any
	if err := json.Unmarshal(fixture.ExpectedParams, &expectedParams); err != nil {
		t.Fatal(err)
	}
	return input, expectedParams
}

func parseExpectedBytecodeBuildInput(
	t *testing.T,
	input resolved.BuildInput,
	context resolved.EncodingContext,
) resolved.ExecutorBytecodeBuildInput {
	t.Helper()

	var routePlan resolved.RoutePlan
	if err := json.Unmarshal(input.RoutePlan, &routePlan); err != nil {
		t.Fatal(err)
	}

	resolvedLegs := make([]resolved.ResolvedLeg, 0, len(input.ResolvedLegs))
	for index, raw := range input.ResolvedLegs {
		var resolvedLeg resolved.ResolvedLeg
		if err := json.Unmarshal(raw, &resolvedLeg); err != nil {
			t.Fatalf("parse resolvedLegs[%d]: %v", index, err)
		}
		resolvedLegs = append(resolvedLegs, resolvedLeg)
	}

	var wethPlan *resolved.WethPlan
	if input.WethPlan != nil && !bytes.Equal(bytes.TrimSpace(*input.WethPlan), []byte("null")) {
		var parsedWethPlan resolved.WethPlan
		if err := json.Unmarshal(*input.WethPlan, &parsedWethPlan); err != nil {
			t.Fatal(err)
		}
		wethPlan = &parsedWethPlan
	}

	return resolved.ExecutorBytecodeBuildInput{
		ExecutorType: input.ExecutorType,
		Context:      context,
		RoutePlan:    routePlan,
		ResolvedLegs: resolvedLegs,
		Sender:       input.UserAddress,
		SrcToken:     input.SrcToken,
		DestToken:    input.DestToken,
		DestAmount:   input.DestAmount,
		WethPlan:     wethPlan,
	}
}
