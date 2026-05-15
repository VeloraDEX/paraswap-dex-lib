package resolved_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/executor"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/executortest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildTransactionFromResolvedMatchesGenericSuccessFixtures(t *testing.T) {
	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Buckets[testfixtures.BucketPhase2GenericSuccess] {
		t.Run(fixture.Name, func(t *testing.T) {
			var input resolved.BuildInput
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

			bytecode, ok := expectedParams[4].(string)
			if !ok {
				t.Fatalf("expectedParams[4] is not bytecode string: %#v", expectedParams[4])
			}

			factory := &fixtureBytecodeFactory{bytecode: resolved.HexBytes(bytecode)}
			deps := buildDepsForInput(t, input)
			deps.ExecutorBytecodeBuilderFactory = factory

			got, err := resolved.BuildTransactionFromResolved(input, deps)
			if err != nil {
				t.Fatal(err)
			}

			if !reflect.DeepEqual(got.Params, expectedParams) {
				t.Fatalf("params mismatch:\n got: %#v\nwant: %#v", got.Params, expectedParams)
			}
			if !reflect.DeepEqual(got.TxObject, expectedTx) {
				t.Fatalf("txObject mismatch:\n got: %#v\nwant: %#v", got.TxObject, expectedTx)
			}
			if factory.createCalls != 1 {
				t.Fatalf("factory calls mismatch: got %d want 1", factory.createCalls)
			}
			if factory.builder == nil || factory.builder.buildCalls != 1 {
				t.Fatalf("builder calls mismatch: got %#v want one call", factory.builder)
			}
			if factory.executorType != input.ExecutorType {
				t.Fatalf("factory executor type mismatch: got %s want %s", factory.executorType, input.ExecutorType)
			}
			if !reflect.DeepEqual(factory.context, deps.EncodingContext) {
				t.Fatalf("factory context mismatch:\n got: %#v\nwant: %#v", factory.context, deps.EncodingContext)
			}
			wantBuilderInput := executortest.ParseExpectedBytecodeBuildInput(t, input, deps.EncodingContext)
			if !reflect.DeepEqual(factory.builder.input, wantBuilderInput) {
				t.Fatalf(
					"bytecode builder input mismatch:\n got: %#v\nwant: %#v",
					factory.builder.input,
					wantBuilderInput,
				)
			}
		})
	}
}

func TestBuildTransactionFromResolvedMatchesRealBuilderFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-simple-sell-approved",
		"executor01-multiswap-sell",
		"executor02-vertical-branch-sell",
		"executor02-multiswap-sell",
		"executor02-megaswap-sell",
		"executor03-buy",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			fixture, input := loadBuildInput(t, fixtureName)
			var expectedParams []any
			if err := json.Unmarshal(fixture.ExpectedParams, &expectedParams); err != nil {
				t.Fatal(err)
			}
			var expectedTx resolved.TxObject
			if err := json.Unmarshal(fixture.ExpectedTx, &expectedTx); err != nil {
				t.Fatal(err)
			}
			expectedBytecode, ok := expectedParams[4].(string)
			if !ok {
				t.Fatalf("expectedParams[4] is not bytecode string: %#v", expectedParams[4])
			}

			deps := buildDepsForInput(t, input)
			deps.ExecutorBytecodeBuilderFactory = executor.NewFactory()

			got, err := resolved.BuildTransactionFromResolved(input, deps)
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Params) != len(expectedParams) {
				t.Fatalf("params length mismatch: got %d want %d", len(got.Params), len(expectedParams))
			}
			if gotBytecode, ok := got.Params[4].(string); !ok || gotBytecode != expectedBytecode {
				t.Fatalf("bytecode mismatch:\n got: %#v\nwant: %s", got.Params[4], expectedBytecode)
			}
			if !reflect.DeepEqual(got.Params, expectedParams) {
				t.Fatalf("params mismatch:\n got: %#v\nwant: %#v", got.Params, expectedParams)
			}
			if !reflect.DeepEqual(got.TxObject, expectedTx) {
				t.Fatalf("txObject mismatch:\n got: %#v\nwant: %#v", got.TxObject, expectedTx)
			}
		})
	}
}

func TestBuildTransactionFromResolvedRejectsMissingBytecodeFactory(t *testing.T) {
	_, input := loadBuildInput(t, "executor01-simple-sell-approved")
	deps := buildDepsForInput(t, input)

	_, err := resolved.BuildTransactionFromResolved(input, deps)
	if err == nil || err.Error() != "executor bytecode builder factory is required" {
		t.Fatalf("expected missing bytecode factory error, got %v", err)
	}
}

func TestBuildTransactionFromResolvedRejectsExecutor02BuyBeforeFactory(t *testing.T) {
	_, input := loadBuildInput(t, "executor02-vertical-branch-sell")
	input.Side = resolved.SideBuy
	input.ContractMethod = resolved.ContractMethodSwapExactAmountOut
	deps := buildDepsForInput(t, input)
	factory := &fixtureBytecodeFactory{bytecode: "0x"}
	deps.ExecutorBytecodeBuilderFactory = factory

	_, err := resolved.BuildTransactionFromResolved(input, deps)
	if err == nil || err.Error() != "Executor02 BUY routes are not implemented in Phase 2c" {
		t.Fatalf("unexpected error:\n got: %v\nwant: %s", err, "Executor02 BUY routes are not implemented in Phase 2c")
	}
	if factory.createCalls != 0 {
		t.Fatalf("factory should not be called for Executor02 BUY, got %d calls", factory.createCalls)
	}
}

func TestBuildTransactionFromResolvedRejectsExecutor02OutMethodBeforeFactory(t *testing.T) {
	_, input := loadBuildInput(t, "executor02-vertical-branch-sell")
	input.ContractMethod = resolved.ContractMethodSwapExactAmountOutPro
	deps := buildDepsForInput(t, input)
	factory := &fixtureBytecodeFactory{bytecode: "0x"}
	deps.ExecutorBytecodeBuilderFactory = factory

	_, err := resolved.BuildTransactionFromResolved(input, deps)
	if err == nil || err.Error() != "Executor02 BUY routes are not implemented in Phase 2c" {
		t.Fatalf("unexpected error:\n got: %v\nwant: %s", err, "Executor02 BUY routes are not implemented in Phase 2c")
	}
	if factory.createCalls != 0 {
		t.Fatalf("factory should not be called for Executor02 Out method, got %d calls", factory.createCalls)
	}
}

func TestBuildTransactionFromResolvedRejectsExecutor03NonBuyBeforeFactory(t *testing.T) {
	for _, testCase := range []struct {
		name           string
		side           resolved.Side
		contractMethod string
	}{
		{
			name:           "sell exact in",
			side:           resolved.SideSell,
			contractMethod: resolved.ContractMethodSwapExactAmountIn,
		},
		{
			name:           "buy exact in",
			side:           resolved.SideBuy,
			contractMethod: resolved.ContractMethodSwapExactAmountInPro,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, input := loadBuildInput(t, "executor03-buy")
			input.Side = testCase.side
			input.ContractMethod = testCase.contractMethod
			deps := buildDepsForInput(t, input)
			factory := &fixtureBytecodeFactory{bytecode: "0x"}
			deps.ExecutorBytecodeBuilderFactory = factory

			_, err := resolved.BuildTransactionFromResolved(input, deps)
			if err == nil || err.Error() != "Executor03 non-BUY routes are not implemented in Phase 2d" {
				t.Fatalf(
					"unexpected error:\n got: %v\nwant: %s",
					err,
					"Executor03 non-BUY routes are not implemented in Phase 2d",
				)
			}
			if factory.createCalls != 0 {
				t.Fatalf("factory should not be called for Executor03 non-BUY, got %d calls", factory.createCalls)
			}
		})
	}
}

type fixtureBytecodeFactory struct {
	bytecode     resolved.HexBytes
	createCalls  int
	executorType resolved.ExecutorType
	context      resolved.EncodingContext
	builder      *fixtureBytecodeBuilder
}

func (f *fixtureBytecodeFactory) CreateExecutorBytecodeBuilder(
	executorType resolved.ExecutorType,
	context resolved.EncodingContext,
) (resolved.ExecutorBytecodeBuilder, error) {
	f.createCalls++
	f.executorType = executorType
	f.context = context
	f.builder = &fixtureBytecodeBuilder{bytecode: f.bytecode}
	return f.builder, nil
}

type fixtureBytecodeBuilder struct {
	bytecode   resolved.HexBytes
	buildCalls int
	input      resolved.ExecutorBytecodeBuildInput
}

func (b *fixtureBytecodeBuilder) BuildBytecode(
	input resolved.ExecutorBytecodeBuildInput,
) (resolved.HexBytes, error) {
	b.buildCalls++
	b.input = input
	return b.bytecode, nil
}
