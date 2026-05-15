package executor

import (
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/executortest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestWETHBuildBytecodeMatchesFixture(t *testing.T) {
	input, expectedParams := executortest.LoadBuildInputWithExpectedParams(t, "weth-only-eth-to-weth")
	expectedBytecode := executortest.ExpectedBytecode(t, expectedParams)
	if expectedBytecode != "0x" {
		t.Fatalf("fixture bytecode mismatch: got %s want 0x", expectedBytecode)
	}

	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewWETHBuilder()

	got, err := builder.BuildBytecode(executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext))
	if err != nil {
		t.Fatal(err)
	}
	if got != resolved.HexBytes("0x") {
		t.Fatalf("bytecode mismatch: got %s want 0x", got)
	}
	if got != expectedBytecode {
		t.Fatalf("fixture bytecode mismatch:\n got: %s\nwant: %s", got, expectedBytecode)
	}
}
