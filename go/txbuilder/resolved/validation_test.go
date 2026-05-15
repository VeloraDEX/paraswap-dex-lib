package resolved_test

import (
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestValidateDepsAcceptsFixtureDeps(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-simple-sell-approved",
		"executor02-multiswap-sell",
		"executor03-buy",
		"weth-only-eth-to-weth",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			_, input := loadBuildInput(t, fixtureName)
			deps := buildDepsForInput(t, input)

			if err := resolved.ValidateSupportedContractMethod(input.ContractMethod); err != nil {
				t.Fatal(err)
			}
			if err := resolved.ValidateExecutorDeps(input, deps); err != nil {
				t.Fatal(err)
			}
			if err := resolved.ValidateEncodingContextDeps(input, deps); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestValidateExecutorDepsRejectsExecutorAddressMismatchFixture(t *testing.T) {
	fixture, input := loadBuildInput(t, "executor-address-mismatch")
	deps := buildDepsForInput(t, input)

	err := resolved.ValidateExecutorDeps(input, deps)
	if err == nil {
		t.Fatal("expected executor address mismatch")
	}
	if err.Error() != fixture.ExpectedError {
		t.Fatalf("unexpected error:\n got: %s\nwant: %s", err, fixture.ExpectedError)
	}
}

func TestValidateDepsRejectsMismatches(t *testing.T) {
	_, input := loadBuildInput(t, "executor01-simple-sell-approved")
	deps := buildDepsForInput(t, input)

	for _, testCase := range []struct {
		name   string
		mutate func(resolved.BuildInput, resolved.BuildDeps) (resolved.BuildInput, resolved.BuildDeps)
		check  func(resolved.BuildInput, resolved.BuildDeps) error
		want   string
	}{
		{
			name: "unsupported executor type",
			mutate: func(input resolved.BuildInput, deps resolved.BuildDeps) (resolved.BuildInput, resolved.BuildDeps) {
				input.ExecutorType = "Executor99"
				return input, deps
			},
			check: resolved.ValidateExecutorDeps,
			want:  "unsupported executor type: Executor99",
		},
		{
			name: "network",
			mutate: func(input resolved.BuildInput, deps resolved.BuildDeps) (resolved.BuildInput, resolved.BuildDeps) {
				deps.EncodingContext.Network = input.Network + 1
				return input, deps
			},
			check: resolved.ValidateEncodingContextDeps,
			want:  "network mismatch: input 1, context 2",
		},
		{
			name: "Augustus V6 address",
			mutate: func(input resolved.BuildInput, deps resolved.BuildDeps) (resolved.BuildInput, resolved.BuildDeps) {
				deps.EncodingContext.AugustusV6Address = "0x9999999999999999999999999999999999999999"
				return input, deps
			},
			check: resolved.ValidateEncodingContextDeps,
			want:  "augustusV6Address mismatch: input 0x6a000f20005980200259b80c5102003040001068, context 0x9999999999999999999999999999999999999999",
		},
		{
			name: "wrapped native token address",
			mutate: func(input resolved.BuildInput, deps resolved.BuildDeps) (resolved.BuildInput, resolved.BuildDeps) {
				deps.EncodingContext.WrappedNativeTokenAddress = "0x8888888888888888888888888888888888888888"
				return input, deps
			},
			check: resolved.ValidateEncodingContextDeps,
			want:  "wrappedNativeTokenAddress mismatch: input 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2, context 0x8888888888888888888888888888888888888888",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			mutatedInput, mutatedDeps := testCase.mutate(input, deps)
			err := testCase.check(mutatedInput, mutatedDeps)
			if err == nil || err.Error() != testCase.want {
				t.Fatalf("expected %q, got %v", testCase.want, err)
			}
		})
	}
}

func TestBuildGenericSwapParamsRejectsUnsupportedMethod(t *testing.T) {
	input, expectedParams := loadBuildInputWithExpectedParams(t, "executor01-simple-sell-approved")
	fee, err := resolved.ParseFeeInput(input)
	if err != nil {
		t.Fatal(err)
	}
	input.ContractMethod = "swapExactAmountInOnUniswapV2"

	_, err = resolved.BuildGenericSwapParams(input, fee, expectedParams[4].(string))
	if err == nil || !strings.Contains(err.Error(), "unsupported generic contract method for resolved build: swapExactAmountInOnUniswapV2") {
		t.Fatalf("expected unsupported method error, got %v", err)
	}
}
