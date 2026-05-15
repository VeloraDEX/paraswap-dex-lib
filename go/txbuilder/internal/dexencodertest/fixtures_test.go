package dexencodertest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadTesseraFixtures(t *testing.T) {
	collection, err := LoadTesseraFixtures(KindDexParam)
	if err != nil {
		t.Fatal(err)
	}
	if len(collection.Fixtures) == 0 {
		t.Fatal("expected Tessera dex-param fixtures")
	}
	for _, fixture := range collection.Fixtures {
		if fixture.Kind != KindDexParam {
			t.Fatalf("%s: unexpected kind %s", fixture.Name, fixture.Kind)
		}
		if fixture.DexKey != "tessera" {
			t.Fatalf("%s: unexpected dexKey %s", fixture.Name, fixture.DexKey)
		}
		if len(fixture.Raw) == 0 {
			t.Fatalf("%s: expected raw fixture bytes", fixture.Name)
		}
	}
}

func TestParseFixtureRejectsUnsupportedSchemaVersion(t *testing.T) {
	raw := fixtureJSON("bad-schema", "dex-param", "tessera")
	raw = strings.Replace(raw, `"schemaVersion": 1`, `"schemaVersion": 2`, 1)

	_, err := parseFixture([]byte(raw), "dex-param/bad-schema.json")
	if err == nil || !strings.Contains(err.Error(), "unsupported schemaVersion 2; expected 1") {
		t.Fatalf("expected unsupported schemaVersion error, got %v", err)
	}
}

func TestParseFixtureRejectsUnknownKind(t *testing.T) {
	raw := fixtureJSON("bad-kind", "unknown", "tessera")

	_, err := parseFixture([]byte(raw), "unknown/bad-kind.json")
	if err == nil || !strings.Contains(err.Error(), "unsupported kind unknown") {
		t.Fatalf("expected unsupported kind error, got %v", err)
	}
}

func TestParseFixtureRejectsNameBasenameMismatch(t *testing.T) {
	raw := fixtureJSON("wrong-name", "dex-param", "tessera")

	_, err := parseFixture([]byte(raw), "dex-param/file-name.json")
	if err == nil || !strings.Contains(err.Error(), "name must match fixture file basename") {
		t.Fatalf("expected basename mismatch error, got %v", err)
	}
}

func TestParseFixtureRejectsMissingRequiredFields(t *testing.T) {
	tests := []struct {
		name       string
		raw        string
		wantErrMsg string
	}{
		{
			name:       "missing input",
			raw:        strings.Replace(fixtureJSON("missing-input", "dex-param", "tessera"), `"input": {},`, ``, 1),
			wantErrMsg: "input is required",
		},
		{
			name:       "missing expected",
			raw:        fixtureJSONMissingExpected("missing-expected"),
			wantErrMsg: "expected is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			relPath := "dex-param/" + strings.ReplaceAll(test.name, " ", "-") + ".json"
			_, err := parseFixture([]byte(test.raw), relPath)
			if err == nil || !strings.Contains(err.Error(), test.wantErrMsg) {
				t.Fatalf("expected %q error, got %v", test.wantErrMsg, err)
			}
		})
	}
}

func TestLoadFixtureFilesRejectsDuplicateTesseraNames(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "dex-param/duplicate.json", "duplicate", "dex-param", "tessera")
	writeFixture(t, root, "need-wrap-native/duplicate.json", "duplicate", "dex-param", "tessera")

	_, err := loadFixtureFiles(root, KindDexParam)
	if err == nil || !strings.Contains(err.Error(), "duplicate Tessera fixture name duplicate") {
		t.Fatalf("expected duplicate fixture name error, got %v", err)
	}
}

func writeFixture(t *testing.T, root, relPath, name string, kind FixtureKind, dexKey string) {
	t.Helper()

	path := filepath.Join(root, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(fixtureJSON(name, string(kind), dexKey)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fixtureJSON(name, kind, dexKey string) string {
	return `{
		"schemaVersion": 1,
		"name": "` + name + `",
		"kind": "` + kind + `",
		"network": 8453,
		"dexKey": "` + dexKey + `",
		"input": {},
		"expected": {}
	}`
}

func fixtureJSONMissingExpected(name string) string {
	return `{
		"schemaVersion": 1,
		"name": "` + name + `",
		"kind": "dex-param",
		"network": 8453,
		"dexKey": "tessera",
		"input": {}
	}`
}
