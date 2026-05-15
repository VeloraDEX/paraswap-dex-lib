package resolved

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
)

func TestEncodeDirectCalldataMatchesDirectSuccessFixtures(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}
	augustusABI, err := LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Buckets[testfixtures.BucketPhase3DirectSuccess] {
		t.Run(fixture.Name, func(t *testing.T) {
			var input DirectBuildInput
			if err := json.Unmarshal(fixture.Input, &input); err != nil {
				t.Fatal(err)
			}
			params, err := validateDirectBuildInput(input)
			if err != nil {
				t.Fatal(err)
			}
			var expectedTx TxObject
			if err := json.Unmarshal(fixture.ExpectedTx, &expectedTx); err != nil {
				t.Fatal(err)
			}

			got, err := encodeDirectCalldata(input, params, augustusABI)
			if err != nil {
				t.Fatal(err)
			}
			if got != expectedTx.Data {
				t.Fatalf("direct calldata mismatch:\n got: %s\nwant: %s", got, expectedTx.Data)
			}
		})
	}
}

func TestParseDirectParamsForOutputRejectsNonArrayParams(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage("null"),
		json.RawMessage(`"0x"`),
	} {
		t.Run(string(raw), func(t *testing.T) {
			_, err := ParseDirectParamsForOutput(raw)
			if err == nil || err.Error() != "direct params must be an array" {
				t.Fatalf("unexpected error: got %v want direct params must be an array", err)
			}
		})
	}
}

func TestCoerceDirectParamsForABIRejectsUnsupportedMethod(t *testing.T) {
	augustusABI, err := LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	method := augustusABI.Methods[ContractMethodSwapExactAmountIn]

	_, err = CoerceDirectParamsForABI(ContractMethodSwapExactAmountIn, nil, method)
	if err == nil || err.Error() != "unsupported direct contract method for resolved build: swapExactAmountIn" {
		t.Fatalf("unexpected error: got %v want unsupported direct method", err)
	}
}

func TestEncodeDirectCalldataRejectsMalformedNestedAddress(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}
	fixture, ok := collection.FixtureByName("uniswap-v2-sell")
	if !ok {
		t.Fatal("expected uniswap-v2-sell fixture")
	}
	var input DirectBuildInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		t.Fatal(err)
	}

	var params []any
	if err := json.Unmarshal(input.Params, &params); err != nil {
		t.Fatal(err)
	}
	uniData, ok := params[0].([]any)
	if !ok {
		t.Fatalf("expected nested params array, got %#v", params[0])
	}
	uniData[0] = "0x1234"
	rawParams, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	input.Params = rawParams

	validatedParams, err := validateDirectBuildInput(input)
	if err != nil {
		t.Fatal(err)
	}
	augustusABI, err := LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	_, err = encodeDirectCalldata(input, validatedParams, augustusABI)
	if err == nil {
		t.Fatal("expected malformed nested address error")
	}
	if !strings.Contains(err.Error(), "uniData.srcToken must be a 0x-prefixed 20-byte hex address: 0x1234") {
		t.Fatalf("unexpected error:\n got: %v\nwant nested address validation", err)
	}
}
