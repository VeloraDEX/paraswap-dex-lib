package executortest

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func LoadFixture(t testing.TB, name string) testfixtures.Fixture {
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

func LoadBuildInputWithExpectedParams(
	t testing.TB,
	name string,
) (resolved.BuildInput, []any) {
	t.Helper()

	fixture := LoadFixture(t, name)
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

func ExpectedBytecode(t testing.TB, expectedParams []any) resolved.HexBytes {
	t.Helper()

	bytecode, ok := expectedParams[4].(string)
	if !ok {
		t.Fatalf("expectedParams[4] is not bytecode string: %#v", expectedParams[4])
	}
	return resolved.HexBytes(bytecode)
}

func ParseExpectedBytecodeBuildInput(
	t testing.TB,
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
