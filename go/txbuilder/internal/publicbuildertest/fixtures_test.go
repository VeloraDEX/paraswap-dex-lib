package publicbuildertest

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestLoadPublicBuilderFixtures(t *testing.T) {
	collection, err := LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	if len(collection.Fixtures) == 0 {
		t.Fatal("expected public-builder fixtures")
	}
	fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
	if !ok {
		t.Fatal("expected executor01-simple-sell-approved fixture")
	}
	if fixture.Path != "generic-public/executor01-simple-sell-approved.json" {
		t.Fatalf("unexpected fixture path %s", fixture.Path)
	}
	if fixture.Kind != KindGenericPublic {
		t.Fatalf("unexpected fixture kind %s", fixture.Kind)
	}
	if len(fixture.DexKeys) == 0 {
		t.Fatal("expected dex keys")
	}
	if len(fixture.Input.Request) == 0 {
		t.Fatal("expected request JSON")
	}
	if len(fixture.ExpectedResolvedInput) == 0 {
		t.Fatal("expected resolved input JSON")
	}
}

func TestFixtureRequestDecodesIntoBuildRequest(t *testing.T) {
	collection, err := LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			var request builder.BuildRequest
			decoder := json.NewDecoder(bytes.NewReader(fixture.Input.Request))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&request); err != nil {
				t.Fatalf("decode BuildRequest: %v", err)
			}

			if request.PriceRoute.Network == 0 {
				t.Fatal("expected priceRoute.network")
			}
			if request.PriceRoute.ContractMethod == "" {
				t.Fatal("expected priceRoute.contractMethod")
			}
			if len(request.PriceRoute.BestRoute) == 0 {
				t.Fatal("expected priceRoute.bestRoute")
			}
			if request.UserAddress == "" {
				t.Fatal("expected userAddress")
			}
			if request.MinMaxAmount == "" {
				t.Fatal("expected minMaxAmount")
			}
		})
	}
}

func TestParseFixtureRejectsUnsupportedSchemaVersion(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 2,
		"name": "bad-schema",
		"kind": "generic-public",
		"dexKeys": ["ExampleDex"],
		"input": {"request": {}, "options": {"skipApprovalCheck": false}},
		"expectedResolvedInput": {},
		"expectedParams": [],
		"expectedTx": {}
	}`)

	_, err := parseFixture(raw, "generic-public/bad-schema.json")
	if err == nil || !strings.Contains(err.Error(), "unsupported schemaVersion 2; expected 1") {
		t.Fatalf("expected unsupported schemaVersion error, got %v", err)
	}
}

func TestParseFixtureRejectsUnknownKind(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 1,
		"name": "bad-kind",
		"kind": "unknown",
		"dexKeys": ["ExampleDex"],
		"input": {"request": {}, "options": {"skipApprovalCheck": false}},
		"expectedResolvedInput": {},
		"expectedParams": [],
		"expectedTx": {}
	}`)

	_, err := parseFixture(raw, "generic-public/bad-kind.json")
	if err == nil || !strings.Contains(err.Error(), "unsupported kind unknown") {
		t.Fatalf("expected unsupported kind error, got %v", err)
	}
}

func TestParseFixtureRejectsMissingOptions(t *testing.T) {
	for _, test := range []struct {
		name       string
		relPath    string
		raw        string
		wantErrMsg string
	}{
		{
			name:    "missing options",
			relPath: "generic-public/missing-options.json",
			raw: `{
				"schemaVersion": 1,
				"name": "missing-options",
				"kind": "generic-public",
				"dexKeys": ["ExampleDex"],
				"input": {"request": {}},
				"expectedResolvedInput": {},
				"expectedParams": [],
				"expectedTx": {}
			}`,
			wantErrMsg: "input.options is required",
		},
		{
			name:    "missing skipApprovalCheck",
			relPath: "generic-public/missing-skip-approval-check.json",
			raw: `{
				"schemaVersion": 1,
				"name": "missing-skip-approval-check",
				"kind": "generic-public",
				"dexKeys": ["ExampleDex"],
				"input": {"request": {}, "options": {}},
				"expectedResolvedInput": {},
				"expectedParams": [],
				"expectedTx": {}
			}`,
			wantErrMsg: "input.options.skipApprovalCheck is required",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseFixture([]byte(test.raw), test.relPath)
			if err == nil || !strings.Contains(err.Error(), test.wantErrMsg) {
				t.Fatalf("expected %q error, got %v", test.wantErrMsg, err)
			}
		})
	}
}

func TestParseFixtureRejectsNameBasenameMismatch(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 1,
		"name": "wrong-name",
		"kind": "generic-public",
		"dexKeys": ["ExampleDex"],
		"input": {"request": {}, "options": {"skipApprovalCheck": false}},
		"expectedResolvedInput": {},
		"expectedParams": [],
		"expectedTx": {}
	}`)

	_, err := parseFixture(raw, "generic-public/file-name.json")
	if err == nil || !strings.Contains(err.Error(), "name must match fixture file basename") {
		t.Fatalf("expected basename mismatch error, got %v", err)
	}
}

func TestLoadFixtureFilesRejectsDuplicateNames(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "generic-public/duplicate.json", "duplicate")
	writeFixture(t, root, "other/duplicate.json", "duplicate")

	_, err := loadFixtureFiles(root)
	if err == nil || !strings.Contains(err.Error(), "duplicate fixture name duplicate") {
		t.Fatalf("expected duplicate fixture name error, got %v", err)
	}
}

func writeFixture(t *testing.T, root, relPath, name string) {
	t.Helper()

	path := filepath.Join(root, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	raw := `{
		"schemaVersion": 1,
		"name": "` + name + `",
		"kind": "generic-public",
		"dexKeys": ["ExampleDex"],
		"input": {"request": {}, "options": {"skipApprovalCheck": false}},
		"expectedResolvedInput": {
			"routePlan": {"routes": []},
			"resolvedLegs": [],
			"executorType": "Executor01",
			"executorAddress": "0x0000000000000000000000000000000000000000",
			"augustusV6Address": "0x0000000000000000000000000000000000000000",
			"wrappedNativeTokenAddress": "0x0000000000000000000000000000000000000000",
			"network": 1,
			"srcToken": "` + string(resolved.NullAddress) + `",
			"destToken": "` + string(resolved.NullAddress) + `",
			"srcAmount": "1",
			"destAmount": "1",
			"minMaxAmount": "1",
			"quotedAmount": "1",
			"side": "SELL",
			"contractMethod": "swapExactAmountIn",
			"blockNumber": 1,
			"userAddress": "0x0000000000000000000000000000000000000000",
			"beneficiary": "0x0000000000000000000000000000000000000000",
			"permit": "0x",
			"uuid": "fixture-test",
			"fee": {
				"partnerAddress": "0x0000000000000000000000000000000000000000",
				"partnerFeePercent": "0",
				"takeSurplus": false,
				"isCapSurplus": true,
				"isSurplusToUser": false,
				"isDirectFeeTransfer": false
			}
		},
		"expectedParams": [],
		"expectedTx": {
			"from": "0x0000000000000000000000000000000000000000",
			"to": "0x0000000000000000000000000000000000000000",
			"value": "0",
			"data": "0x"
		}
	}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
}
