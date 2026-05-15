package resolved_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildTransactionFromResolvedMatchesGenericNegativeFixtures(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Buckets[testfixtures.BucketPhase2GenericNegative] {
		t.Run(fixture.Name, func(t *testing.T) {
			var input resolved.BuildInput
			if err := json.Unmarshal(fixture.Input, &input); err != nil {
				t.Fatal(err)
			}

			factory := &failingBytecodeFactory{}
			deps := buildDepsForInput(t, input)
			deps.ExecutorBytecodeBuilderFactory = factory

			_, err := resolved.BuildTransactionFromResolved(input, deps)
			if err == nil {
				t.Fatal("expected error")
			}
			if err.Error() != fixture.ExpectedError {
				t.Fatalf("unexpected error:\n got: %s\nwant: %s", err, fixture.ExpectedError)
			}
			if factory.createCalls != 0 {
				t.Fatalf("bytecode factory should not be called on validation failure; got %d calls", factory.createCalls)
			}
		})
	}
}

type failingBytecodeFactory struct {
	createCalls int
}

func (f *failingBytecodeFactory) CreateExecutorBytecodeBuilder(
	resolved.ExecutorType,
	resolved.EncodingContext,
) (resolved.ExecutorBytecodeBuilder, error) {
	f.createCalls++
	return failingBytecodeBuilder{}, nil
}

type failingBytecodeBuilder struct{}

func (failingBytecodeBuilder) BuildBytecode(
	resolved.ExecutorBytecodeBuildInput,
) (resolved.HexBytes, error) {
	return "", fmt.Errorf("bytecode builder should not be called")
}
