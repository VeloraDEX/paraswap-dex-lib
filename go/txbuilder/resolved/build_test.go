package resolved_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/executor"
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
			wantBuilderInput := parseExpectedBytecodeBuildInput(t, input, deps.EncodingContext)
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

func TestBuildTransactionFromResolvedMatchesExecutor01RealBuilderFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-simple-sell-approved",
		"executor01-multiswap-sell",
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

func parseExpectedBytecodeBuildInput(
	t *testing.T,
	input resolved.BuildInput,
	context resolved.EncodingContext,
) resolved.ExecutorBytecodeBuildInput {
	t.Helper()

	routePlan := parseRoutePlanForTest(t, input)
	resolvedLegs := parseResolvedLegsForTest(t, input)
	wethPlan := parseWethPlanForTest(t, input)

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

func parseRoutePlanForTest(t *testing.T, input resolved.BuildInput) resolved.RoutePlan {
	t.Helper()

	var routePlan resolved.RoutePlan
	if err := json.Unmarshal(input.RoutePlan, &routePlan); err != nil {
		t.Fatal(err)
	}
	return routePlan
}

func parseResolvedLegsForTest(t *testing.T, input resolved.BuildInput) []resolved.ResolvedLeg {
	t.Helper()

	resolvedLegs := make([]resolved.ResolvedLeg, 0, len(input.ResolvedLegs))
	for index, raw := range input.ResolvedLegs {
		var resolvedLeg resolved.ResolvedLeg
		if err := json.Unmarshal(raw, &resolvedLeg); err != nil {
			t.Fatalf("parse resolvedLegs[%d]: %v", index, err)
		}
		resolvedLegs = append(resolvedLegs, resolvedLeg)
	}
	return resolvedLegs
}

func parseWethPlanForTest(t *testing.T, input resolved.BuildInput) *resolved.WethPlan {
	t.Helper()

	if input.WethPlan == nil || bytes.Equal(bytes.TrimSpace(*input.WethPlan), []byte("null")) {
		return nil
	}

	var wethPlan resolved.WethPlan
	if err := json.Unmarshal(*input.WethPlan, &wethPlan); err != nil {
		t.Fatal(err)
	}
	return &wethPlan
}
