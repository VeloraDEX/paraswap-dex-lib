package testfixtures

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

func TestLoadResolvedBuildFixtures(t *testing.T) {
	collection, err := LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	if len(collection.Fixtures) == 0 {
		t.Fatal("expected resolved-build fixtures")
	}
	fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
	if !ok {
		t.Fatal("expected executor01-simple-sell-approved fixture")
	}
	if fixture.Path != "generic/executor01-simple-sell-approved.json" {
		t.Fatalf("unexpected fixture path %s", fixture.Path)
	}
	if len(fixture.Coverage) == 0 {
		t.Fatal("expected non-empty coverage")
	}

	manifestCount := 0
	for _, bucket := range allBuckets {
		manifestCount += len(collection.Manifest.Buckets[bucket])
		if len(collection.Manifest.Buckets[bucket]) != len(collection.Buckets[bucket]) {
			t.Fatalf("bucket %s manifest and fixture counts differ", bucket)
		}
	}
	if manifestCount != len(collection.Fixtures) {
		t.Fatalf("manifest count %d does not match fixture count %d", manifestCount, len(collection.Fixtures))
	}
	if len(collection.Buckets[BucketPhase2GenericSuccess]) == 0 {
		t.Fatal("expected generic success bucket")
	}
	if len(collection.Buckets[BucketPhase2GenericNegative]) == 0 {
		t.Fatal("expected generic negative bucket")
	}
	if len(collection.Buckets[BucketPhase3DirectSuccess]) == 0 {
		t.Fatal("expected direct success bucket")
	}
	if len(collection.Buckets[BucketPhase3DirectNegative]) == 0 {
		t.Fatal("expected direct negative bucket")
	}

	for _, bucket := range allBuckets {
		var paths []string
		for _, entry := range collection.Manifest.Buckets[bucket] {
			paths = append(paths, entry.Path)
		}
		if !sort.StringsAreSorted(paths) {
			t.Fatalf("manifest bucket %s is not sorted by path", bucket)
		}
	}
}

func TestFixtureLoaderIgnoresUnknownMetadata(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 1,
		"name": "metadata-tolerance",
		"kind": "generic",
		"coverage": ["generic"],
		"input": {},
		"expectedParams": [],
		"expectedTx": {},
		"orchestration": {"ignored": true},
		"boundaryOnly": true,
		"boundaryOnlyReason": "ignored"
	}`)

	if _, err := parseFixture(raw, "generic/metadata-tolerance.json"); err != nil {
		t.Fatal(err)
	}
}

func TestParseFixtureRejectsUnsupportedSchemaVersion(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 2,
		"name": "bad-schema",
		"kind": "generic",
		"coverage": ["generic"],
		"input": {},
		"expectedParams": [],
		"expectedTx": {}
	}`)

	_, err := parseFixture(raw, "generic/bad-schema.json")
	if err == nil || !strings.Contains(err.Error(), "unsupported schemaVersion 2; expected 1") {
		t.Fatalf("expected unsupported schemaVersion error, got %v", err)
	}
}

func TestParseFixtureRequiresKindSpecificFields(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 1,
		"name": "missing-error",
		"kind": "negative",
		"coverage": ["negative"],
		"input": {}
	}`)

	_, err := parseFixture(raw, "negative/missing-error.json")
	if err == nil || !strings.Contains(err.Error(), "expectedError is required") {
		t.Fatalf("expected expectedError error, got %v", err)
	}
}

func TestParseManifestRejectsUnsupportedSchemaVersion(t *testing.T) {
	raw := []byte(`{"schemaVersion":2,"buckets":{}}`)

	_, err := ParseManifestJSON(raw)
	if err == nil || !strings.Contains(err.Error(), "unsupported manifest schemaVersion 2; expected 1") {
		t.Fatalf("expected unsupported manifest schemaVersion error, got %v", err)
	}
}

func TestValidateManifestRejectsNameKindAndHashMismatch(t *testing.T) {
	collection, err := LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, mutate := range []struct {
		name       string
		mutate     func(*ManifestEntry)
		wantErrMsg string
	}{
		{
			name:       "name",
			mutate:     func(entry *ManifestEntry) { entry.Name = "wrong-name" },
			wantErrMsg: "manifest name mismatch",
		},
		{
			name:       "kind",
			mutate:     func(entry *ManifestEntry) { entry.Kind = KindDirect },
			wantErrMsg: "manifest kind mismatch",
		},
		{
			name:       "hash",
			mutate:     func(entry *ManifestEntry) { entry.SHA256 = strings.Repeat("0", 64) },
			wantErrMsg: "manifest hash mismatch",
		},
	} {
		t.Run(mutate.name, func(t *testing.T) {
			manifest := cloneManifest(t, collection.Manifest)
			entry := firstManifestEntry(t, &manifest)
			mutate.mutate(entry)

			_, err := validateManifest(collection.Fixtures, manifest)
			if err == nil || !strings.Contains(err.Error(), mutate.wantErrMsg) {
				t.Fatalf("expected %q error, got %v", mutate.wantErrMsg, err)
			}
		})
	}
}

func TestValidateManifestRejectsWrongBucket(t *testing.T) {
	collection, err := LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	manifest := cloneManifest(t, collection.Manifest)
	entry := manifest.Buckets[BucketPhase2GenericSuccess][0]
	manifest.Buckets[BucketPhase2GenericSuccess] =
		manifest.Buckets[BucketPhase2GenericSuccess][1:]
	manifest.Buckets[BucketPhase3DirectSuccess] = append(
		manifest.Buckets[BucketPhase3DirectSuccess],
		entry,
	)

	_, err = validateManifest(collection.Fixtures, manifest)
	if err == nil || !strings.Contains(err.Error(), "manifest bucket mismatch") {
		t.Fatalf("expected manifest bucket mismatch error, got %v", err)
	}
}

func TestValidateManifestRejectsMissingFixtureReferences(t *testing.T) {
	collection, err := LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}

	t.Run("manifest references missing fixture", func(t *testing.T) {
		manifest := cloneManifest(t, collection.Manifest)
		manifest.Buckets[BucketPhase2GenericSuccess] = append(
			manifest.Buckets[BucketPhase2GenericSuccess],
			ManifestEntry{
				Kind:   KindGeneric,
				Name:   "nonexistent",
				Path:   "generic/nonexistent.json",
				SHA256: strings.Repeat("0", 64),
			},
		)

		_, err := validateManifest(collection.Fixtures, manifest)
		if err == nil || !strings.Contains(err.Error(), "manifest references missing fixture") {
			t.Fatalf("expected missing fixture reference error, got %v", err)
		}
	})

	t.Run("fixture missing from manifest", func(t *testing.T) {
		manifest := cloneManifest(t, collection.Manifest)
		manifest.Buckets[BucketPhase2GenericSuccess] =
			manifest.Buckets[BucketPhase2GenericSuccess][1:]

		_, err := validateManifest(collection.Fixtures, manifest)
		if err == nil || !strings.Contains(err.Error(), "is missing from manifest") {
			t.Fatalf("expected fixture missing from manifest error, got %v", err)
		}
	})
}

func cloneManifest(t *testing.T, manifest Manifest) Manifest {
	t.Helper()

	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	clone, err := ParseManifestJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return clone
}

func firstManifestEntry(t *testing.T, manifest *Manifest) *ManifestEntry {
	t.Helper()

	for _, bucket := range allBuckets {
		if len(manifest.Buckets[bucket]) > 0 {
			return &manifest.Buckets[bucket][0]
		}
	}
	t.Fatal("manifest has no entries")
	return nil
}
