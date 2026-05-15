package builder_test

import (
	"context"
	"reflect"
	"sort"
	"strings"
	"testing"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/dex/registry"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/dex/tessera"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/executor"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/publicbuildertest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

var tesseraPublicFixtureNames = []string{
	"tessera-base-usdc-to-weth-sell",
	"tessera-base-usdc-to-eth-sell",
	"tessera-base-weth-to-usdc-sell",
	"tessera-base-eth-to-usdc-sell",
	"tessera-base-usdc-to-weth-buy",
	"tessera-base-usdc-to-eth-buy",
	"tessera-bsc-wbnb-to-usdt-sell",
	"tessera-bsc-bnb-to-usdt-sell",
	"tessera-bsc-usdt-to-wbnb-sell",
	"tessera-bsc-usdt-to-bnb-sell",
	"tessera-bsc-wbnb-to-usdt-buy",
	"tessera-bsc-bnb-to-usdt-buy",
}

func TestTesseraPublicFixtureSetMatchesPlan(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	var got []string
	for _, fixture := range collection.Fixtures {
		if !strings.HasPrefix(fixture.Name, "tessera-") {
			continue
		}
		got = append(got, fixture.Name)

		expectedDexCalls, err := publicbuildertest.DecodeExpectedDexCalls(fixture)
		if err != nil {
			t.Fatal(err)
		}
		for _, call := range expectedDexCalls {
			if call.DexKey != "Tessera" || call.DexParamInput.DexKey != "Tessera" {
				t.Fatalf("%s: Tessera route label was normalized in DEX call: %#v", fixture.Name, call)
			}
		}
	}
	sort.Strings(got)
	want := append([]string(nil), tesseraPublicFixtureNames...)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Tessera fixture set mismatch:\n got: %v\nwant: %v", got, want)
	}
}

func TestBuildGenericTesseraPublicFixturesWithRealEncoder(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixtureName := range tesseraPublicFixtureNames {
		fixture, ok := collection.FixtureByName(fixtureName)
		if !ok {
			t.Fatalf("missing fixture %s", fixtureName)
		}

		t.Run(fixture.Name, func(t *testing.T) {
			req, err := publicbuildertest.DecodeBuildRequest(fixture)
			if err != nil {
				t.Fatal(err)
			}
			expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
			if err != nil {
				t.Fatal(err)
			}

			inputDeps := buildTesseraDeps(t, fixture, expectedInput)
			gotInput, err := builder.BuildGenericInputForTest(context.Background(), req, inputDeps)
			if err != nil {
				t.Fatal(err)
			}
			assertJSONEqual(t, "resolved input", fixture.ExpectedResolvedInput, gotInput)
			assertTesseraDepsConsumed(t, inputDeps)

			outputDeps := buildTesseraDeps(t, fixture, expectedInput)
			output, err := builder.BuildGeneric(context.Background(), req, outputDeps)
			if err != nil {
				t.Fatal(err)
			}
			assertJSONEqual(t, "params", fixture.ExpectedParams, output.Params)
			expectedTx, err := publicbuildertest.DecodeExpectedTx(fixture)
			if err != nil {
				t.Fatal(err)
			}
			assertGenericTxObjectMatches(
				t,
				outputDeps.AugustusV6ABI,
				expectedInput.ContractMethod,
				fixture.Name,
				output.TxObject,
				expectedTx,
			)
			assertTesseraDepsConsumed(t, outputDeps)
		})
	}
}

func buildTesseraDeps(t *testing.T, fixture publicbuildertest.Fixture, expectedInput resolved.BuildInput) builder.Deps {
	t.Helper()

	resolvedDeps, err := resolvedtest.BuildDepsFromFixtureInput(expectedInput)
	if err != nil {
		t.Fatal(err)
	}
	expectedDexCalls, err := publicbuildertest.DecodeExpectedDexCalls(fixture)
	if err != nil {
		t.Fatal(err)
	}
	expectedApprovalRequests, err := publicbuildertest.DecodeExpectedApprovalRequests(fixture)
	if err != nil {
		t.Fatal(err)
	}
	approvalDecisions, err := publicbuildertest.DecodeApprovalDecisions(fixture)
	if err != nil {
		t.Fatal(err)
	}

	tesseraEncoder := tessera.New(tessera.DefaultConfig())
	realRegistry := registry.MustNew(registry.Entry{
		Keys:    []string{"tessera", "Tessera"},
		Encoder: tesseraEncoder,
	})

	return builder.Deps{
		EncodingContext: resolvedDeps.EncodingContext,
		AugustusV6ABI:   resolvedDeps.AugustusV6ABI,
		ExecutorFactory: executor.NewFactory(),
		DexRegistry: publicbuildertest.NewRecordingDexRegistry(
			realRegistry,
			expectedDexCalls,
		),
		ApprovalChecker: &publicbuildertest.FixtureApprovalChecker{
			Expected:        expectedApprovalRequests,
			Decisions:       approvalDecisions,
			ExpectedSpender: expectedInput.ExecutorAddress,
		},
		Options: builder.Options{
			SkipApprovalCheck: fixture.Input.Options.SkipApprovalCheck,
		},
	}
}

func assertTesseraDepsConsumed(t *testing.T, deps builder.Deps) {
	t.Helper()

	registry := deps.DexRegistry.(*publicbuildertest.RecordingDexRegistry)
	if err := registry.AssertConsumed(); err != nil {
		t.Fatal(err)
	}
	if checker, ok := deps.ApprovalChecker.(*publicbuildertest.FixtureApprovalChecker); ok &&
		len(checker.Expected) > 0 &&
		!deps.Options.SkipApprovalCheck &&
		!checker.Called {
		t.Fatal("approval checker was not called")
	}
}

func assertGenericTxObjectMatches(
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
		t.Fatalf("txObject non-data mismatch:\n got: %#v\nwant: %#v", gotWithoutData, expectedWithoutData)
	}
	if diff := resolvedtest.GenericCalldataDiff(
		augustusV6ABI,
		contractMethod,
		fixtureName,
		got.Data,
		expected.Data,
	); diff != "" {
		t.Fatal(diff)
	}
}
