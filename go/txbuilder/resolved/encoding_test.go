package resolved_test

import (
	"reflect"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestAugustusV6MethodSelectors(t *testing.T) {
	augustusABI, err := resolved.LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}

	for _, testCase := range []struct {
		method string
		want   string
	}{
		{method: resolved.ContractMethodSwapExactAmountIn, want: "0xe3ead59e"},
		{method: resolved.ContractMethodSwapExactAmountOut, want: "0x7f457675"},
		{method: resolved.ContractMethodSwapExactAmountInPro, want: "0x0d893d62"},
		{method: resolved.ContractMethodSwapExactAmountOutPro, want: "0x44224add"},
	} {
		t.Run(testCase.method, func(t *testing.T) {
			got, err := resolved.AugustusV6MethodSelector(augustusABI, testCase.method)
			if err != nil {
				t.Fatal(err)
			}
			if got != testCase.want {
				t.Fatalf("selector mismatch: got %s want %s", got, testCase.want)
			}
		})
	}
}

func TestPackUUIDAndBlockMatchesFixtureMetadata(t *testing.T) {
	input, expectedParams := loadBuildInputWithExpectedParams(t, "executor01-simple-sell-approved")

	got, err := resolved.PackUUIDAndBlock(input.UUID, input.BlockNumber)
	if err != nil {
		t.Fatal(err)
	}

	expectedSwapData := expectedParams[1].([]any)
	want := expectedSwapData[5].(string)
	if got != want {
		t.Fatalf("metadata mismatch: got %s want %s", got, want)
	}
}

func TestPackUUIDAndBlockRejectsMalformedInput(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		uuid        string
		blockNumber int64
	}{
		{name: "malformed uuid", uuid: "bad", blockNumber: 1},
		{name: "negative block", uuid: "11111111-1111-1111-1111-111111111111", blockNumber: -1},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := resolved.PackUUIDAndBlock(testCase.uuid, testCase.blockNumber)
			if err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestBuildGenericSwapParamsMatchesFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-simple-sell-approved",
		"executor03-buy",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			input, expectedParams := loadBuildInputWithExpectedParams(t, fixtureName)
			fee, err := resolved.ParseFeeInput(input)
			if err != nil {
				t.Fatal(err)
			}

			got, err := resolved.BuildGenericSwapParams(input, fee, expectedParams[4].(string))
			if err != nil {
				t.Fatal(err)
			}

			if !reflect.DeepEqual(got, expectedParams) {
				t.Fatalf("params mismatch:\n got: %#v\nwant: %#v", got, expectedParams)
			}
		})
	}
}

func TestBuildGenericSwapParamsAcceptsProMethods(t *testing.T) {
	for _, testCase := range []struct {
		name           string
		fixtureName    string
		contractMethod string
	}{
		{
			name:           "exact in pro",
			fixtureName:    "executor01-simple-sell-approved",
			contractMethod: resolved.ContractMethodSwapExactAmountInPro,
		},
		{
			name:           "exact out pro",
			fixtureName:    "executor03-buy",
			contractMethod: resolved.ContractMethodSwapExactAmountOutPro,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			input, expectedParams := loadBuildInputWithExpectedParams(t, testCase.fixtureName)
			input.ContractMethod = testCase.contractMethod
			fee, err := resolved.ParseFeeInput(input)
			if err != nil {
				t.Fatal(err)
			}

			got, err := resolved.BuildGenericSwapParams(input, fee, expectedParams[4].(string))
			if err != nil {
				t.Fatal(err)
			}

			if !reflect.DeepEqual(got, expectedParams) {
				t.Fatalf("Pro params mismatch:\n got: %#v\nwant: %#v", got, expectedParams)
			}
		})
	}
}

func TestBuildTxValueMatchesFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-eth-weth-deposit",
		"executor01-simple-sell-approved",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			input, expectedTx := loadBuildInputWithExpectedTx(t, fixtureName)
			got, err := resolved.BuildTxValue(input)
			if err != nil {
				t.Fatal(err)
			}
			if got != string(expectedTx.Value) {
				t.Fatalf("tx value mismatch: got %s want %s", got, expectedTx.Value)
			}
		})
	}
}

func TestBuildTxValueBuyNativeAndUnsupportedSide(t *testing.T) {
	_, input := loadBuildInput(t, "executor03-buy")
	input.SrcToken = resolved.NativeTokenAddress
	input.MinMaxAmount = "42"
	input.Side = resolved.SideBuy

	got, err := resolved.BuildTxValue(input)
	if err != nil {
		t.Fatal(err)
	}
	if got != "42" {
		t.Fatalf("BUY native value mismatch: got %s want 42", got)
	}

	input.Side = "UNKNOWN"
	if _, err := resolved.BuildTxValue(input); err == nil {
		t.Fatal("expected unsupported side error for native source")
	}

	input.SrcToken = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
	if _, err := resolved.BuildTxValue(input); err == nil {
		t.Fatal("expected unsupported side error for non-native source")
	}
}
