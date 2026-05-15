package resolved_test

import (
	"encoding/json"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func loadFixture(t *testing.T, name string) testfixtures.Fixture {
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

func loadBuildInput(t *testing.T, name string) (testfixtures.Fixture, resolved.BuildInput) {
	t.Helper()

	fixture := loadFixture(t, name)
	var input resolved.BuildInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		t.Fatal(err)
	}
	return fixture, input
}

func loadBuildInputWithExpectedParams(t *testing.T, name string) (resolved.BuildInput, []any) {
	t.Helper()

	fixture, input := loadBuildInput(t, name)
	var expectedParams []any
	if err := json.Unmarshal(fixture.ExpectedParams, &expectedParams); err != nil {
		t.Fatal(err)
	}
	return input, expectedParams
}

func loadBuildInputWithExpectedTx(t *testing.T, name string) (resolved.BuildInput, resolved.TxObject) {
	t.Helper()

	fixture, input := loadBuildInput(t, name)
	var expectedTx resolved.TxObject
	if err := json.Unmarshal(fixture.ExpectedTx, &expectedTx); err != nil {
		t.Fatal(err)
	}
	return input, expectedTx
}

func buildDepsForInput(t *testing.T, input resolved.BuildInput) resolved.BuildDeps {
	t.Helper()

	deps, err := resolvedtest.BuildDepsFromFixtureInput(input)
	if err != nil {
		t.Fatal(err)
	}
	return deps
}
