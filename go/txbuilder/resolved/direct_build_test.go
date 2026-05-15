package resolved_test

import (
	"encoding/json"
	"reflect"
	"testing"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildDirectTransactionFromResolvedMatchesDirectSuccessFixtures(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Buckets[testfixtures.BucketPhase3DirectSuccess] {
		t.Run(fixture.Name, func(t *testing.T) {
			var input resolved.DirectBuildInput
			if err := json.Unmarshal(fixture.Input, &input); err != nil {
				t.Fatal(err)
			}
			var expectedParams []any
			if err := json.Unmarshal(fixture.ExpectedParams, &expectedParams); err != nil {
				t.Fatal(err)
			}
			var expectedTx resolved.TxObject
			if err := json.Unmarshal(fixture.ExpectedTx, &expectedTx); err != nil {
				t.Fatal(err)
			}

			deps := buildDirectDepsForInput(t, input)
			got, err := resolved.BuildDirectTransactionFromResolved(input, deps)
			if err != nil {
				t.Fatal(err)
			}

			if got.ContractMethod != input.ContractMethod {
				t.Fatalf("contract method mismatch: got %s want %s", got.ContractMethod, input.ContractMethod)
			}
			if !reflect.DeepEqual(got.Params, expectedParams) {
				t.Fatalf("params mismatch:\n got: %#v\nwant: %#v", got.Params, expectedParams)
			}
			assertDirectTxObjectMatches(t, deps.AugustusV6ABI, input.ContractMethod, fixture.Name, got.TxObject, expectedTx)
		})
	}
}

func TestBuildDirectTransactionFromResolvedMatchesDirectNegativeFixtures(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Buckets[testfixtures.BucketPhase3DirectNegative] {
		t.Run(fixture.Name, func(t *testing.T) {
			var input resolved.DirectBuildInput
			if err := json.Unmarshal(fixture.Input, &input); err != nil {
				t.Fatal(err)
			}

			_, err := resolved.BuildDirectTransactionFromResolved(input, buildDirectDepsForInput(t, input))
			if err == nil {
				t.Fatal("expected error")
			}
			if err.Error() != fixture.ExpectedError {
				t.Fatalf("unexpected error:\n got: %s\nwant: %s", err, fixture.ExpectedError)
			}
		})
	}
}

func TestBuildDirectTransactionFromResolvedRejectsMalformedTopLevelFields(t *testing.T) {
	_, input := loadDirectBuildInput(t, "uniswap-v2-sell")

	for _, testCase := range []struct {
		name    string
		mutate  func(*resolved.DirectBuildInput)
		wantErr string
	}{
		{
			name: "non-array null params",
			mutate: func(input *resolved.DirectBuildInput) {
				input.Params = json.RawMessage("null")
			},
			wantErr: "direct params must be an array",
		},
		{
			name: "non-array string params",
			mutate: func(input *resolved.DirectBuildInput) {
				input.Params = json.RawMessage(`"0x"`)
			},
			wantErr: "direct params must be an array",
		},
		{
			name: "user address",
			mutate: func(input *resolved.DirectBuildInput) {
				input.UserAddress = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			},
			wantErr: "userAddress must be a lowercase 42-character hex address",
		},
		{
			name: "augustus address",
			mutate: func(input *resolved.DirectBuildInput) {
				input.AugustusV6Address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			},
			wantErr: "augustusV6Address must be a lowercase 42-character hex address",
		},
		{
			name: "source token",
			mutate: func(input *resolved.DirectBuildInput) {
				input.SrcToken = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			},
			wantErr: "srcToken must be a lowercase 42-character hex address",
		},
		{
			name: "source amount",
			mutate: func(input *resolved.DirectBuildInput) {
				input.SrcAmount = "1.5"
			},
			wantErr: "srcAmount must be a decimal amount string",
		},
		{
			name: "min max amount",
			mutate: func(input *resolved.DirectBuildInput) {
				input.MinMaxAmount = "1.5"
			},
			wantErr: "minMaxAmount must be a decimal amount string",
		},
		{
			name: "gas price",
			mutate: func(input *resolved.DirectBuildInput) {
				input.Gas = &resolved.GasInput{GasPrice: "1.5"}
			},
			wantErr: "gas.gasPrice must be a decimal amount string",
		},
		{
			name: "max fee",
			mutate: func(input *resolved.DirectBuildInput) {
				input.Gas = &resolved.GasInput{MaxFeePerGas: "1.5"}
			},
			wantErr: "gas.maxFeePerGas must be a decimal amount string",
		},
		{
			name: "max priority fee",
			mutate: func(input *resolved.DirectBuildInput) {
				input.Gas = &resolved.GasInput{MaxPriorityFeePerGas: "1.5"}
			},
			wantErr: "gas.maxPriorityFeePerGas must be a decimal amount string",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			testInput := input
			testCase.mutate(&testInput)

			_, err := resolved.BuildDirectTransactionFromResolved(testInput, buildDirectDepsForInput(t, testInput))
			if err == nil || err.Error() != testCase.wantErr {
				t.Fatalf("unexpected error:\n got: %v\nwant: %s", err, testCase.wantErr)
			}
		})
	}
}

func TestBuildDirectTransactionFromResolvedNativeBuyValue(t *testing.T) {
	fixture, input := loadDirectBuildInput(t, "uniswap-v2-buy")
	input.SrcToken = resolved.NativeTokenAddress
	input.MinMaxAmount = "1200"

	deps := buildDirectDepsForInput(t, input)
	got, err := resolved.BuildDirectTransactionFromResolved(input, deps)
	if err != nil {
		t.Fatal(err)
	}

	var expectedTx resolved.TxObject
	if err := json.Unmarshal(fixture.ExpectedTx, &expectedTx); err != nil {
		t.Fatal(err)
	}
	expectedTx.Value = "1200"

	assertDirectTxObjectMatches(t, deps.AugustusV6ABI, input.ContractMethod, fixture.Name, got.TxObject, expectedTx)
}

func loadDirectBuildInput(t *testing.T, name string) (testfixtures.Fixture, resolved.DirectBuildInput) {
	t.Helper()

	fixture := loadFixture(t, name)
	var input resolved.DirectBuildInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		t.Fatal(err)
	}
	return fixture, input
}

func buildDirectDepsForInput(t *testing.T, input resolved.DirectBuildInput) resolved.DirectBuildDeps {
	t.Helper()

	deps, err := resolvedtest.BuildDirectDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	return deps
}

func assertDirectTxObjectMatches(
	t *testing.T,
	augustusV6ABI *ethabi.ABI,
	contractMethod string,
	fixtureName string,
	got resolved.TxObject,
	expected resolved.TxObject,
) {
	t.Helper()

	gotWithoutData := got
	expectedWithoutData := expected
	gotWithoutData.Data = ""
	expectedWithoutData.Data = ""
	if !reflect.DeepEqual(gotWithoutData, expectedWithoutData) {
		t.Fatalf("tx object mismatch:\n got: %#v\nwant: %#v", gotWithoutData, expectedWithoutData)
	}
	if diff := resolvedtest.RawCalldataDiff(
		augustusV6ABI,
		contractMethod,
		fixtureName,
		got.Data,
		expected.Data,
	); diff != "" {
		t.Fatal(diff)
	}
}
