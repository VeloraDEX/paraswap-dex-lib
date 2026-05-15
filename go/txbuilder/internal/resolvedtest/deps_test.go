package resolvedtest

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildDepsFromFixtureInput(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}
	fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
	if !ok {
		t.Fatal("expected executor01-simple-sell-approved fixture")
	}

	var input resolved.BuildInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		t.Fatal(err)
	}

	deps, err := BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}

	if deps.EncodingContext.Network != input.Network {
		t.Fatalf("network mismatch: got %d want %d", deps.EncodingContext.Network, input.Network)
	}
	if deps.EncodingContext.AugustusV6Address != input.AugustusV6Address {
		t.Fatal("Augustus V6 address mismatch")
	}
	if deps.EncodingContext.WrappedNativeTokenAddress != input.WrappedNativeTokenAddress {
		t.Fatal("wrapped native token address mismatch")
	}
	if deps.EncodingContext.ExecutorsAddresses[resolved.ExecutorWETH] != input.WrappedNativeTokenAddress {
		t.Fatal("WETH executor address must come from fixture wrapped native token")
	}
	if deps.EncodingContext.ExecutorsAddresses[resolved.Executor01] == "" {
		t.Fatal("expected Executor01 address")
	}
	if deps.AugustusV6ABI == nil || len(deps.AugustusV6ABI.Methods) == 0 {
		t.Fatal("expected parsed Augustus V6 ABI")
	}
}

func TestParseDepsContractRejectsUnsupportedSchemaVersion(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 2,
		"executorsAddresses": {
			"Executor01": "0x000010036c0190e009a000d0fc3541100a07380a",
			"Executor02": "0x00c600b30fb0400701010f4b080409018b9006e0",
			"Executor03": "0xa000b020c290d000020aac04026b5306d60050f0"
		}
	}`)

	_, err := parseDepsContractJSON(raw)
	if err == nil || !strings.Contains(err.Error(), "unsupported deps schemaVersion 2; expected 1") {
		t.Fatalf("expected unsupported deps schemaVersion error, got %v", err)
	}
}

func TestParseDepsContractRequiresExecutorAddresses(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 1,
		"executorsAddresses": {
			"Executor01": "0x000010036c0190e009a000d0fc3541100a07380a",
			"Executor03": "0xa000b020c290d000020aac04026b5306d60050f0"
		}
	}`)

	_, err := parseDepsContractJSON(raw)
	if err == nil || !strings.Contains(err.Error(), "deps executor address Executor02 is required") {
		t.Fatalf("expected missing executor address error, got %v", err)
	}
}
