package testfixtures

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
)

const (
	FixtureSchemaVersion  = 1
	ManifestSchemaVersion = 1
)

type FixtureKind string

const (
	KindGeneric  FixtureKind = "generic"
	KindDirect   FixtureKind = "direct"
	KindNegative FixtureKind = "negative"
)

type Bucket string

const (
	BucketPhase2GenericSuccess  Bucket = "phase2GenericSuccess"
	BucketPhase2GenericNegative Bucket = "phase2GenericNegative"
	BucketPhase3DirectSuccess   Bucket = "phase3DirectSuccess"
	BucketPhase3DirectNegative  Bucket = "phase3DirectNegative"
)

var allBuckets = []Bucket{
	BucketPhase2GenericSuccess,
	BucketPhase2GenericNegative,
	BucketPhase3DirectSuccess,
	BucketPhase3DirectNegative,
}

type Collection struct {
	RepoRoot    string
	FixtureRoot string
	Manifest    Manifest
	Fixtures    []Fixture
	Buckets     map[Bucket][]Fixture
}

type Fixture struct {
	Path           string
	Raw            []byte
	SchemaVersion  int
	Name           string
	Kind           FixtureKind
	Coverage       []string
	Input          json.RawMessage
	ExpectedParams json.RawMessage
	ExpectedTx     json.RawMessage
	ExpectedError  string
}

type Manifest struct {
	SchemaVersion int
	Buckets       map[Bucket][]ManifestEntry
}

type ManifestEntry struct {
	Kind   FixtureKind `json:"kind"`
	Name   string      `json:"name"`
	Path   string      `json:"path"`
	SHA256 string      `json:"sha256"`
}

func LoadResolvedBuildFixtures() (*Collection, error) {
	root, err := reporoot.Find()
	if err != nil {
		return nil, err
	}

	return LoadResolvedBuildFixturesFromRoot(root)
}

func LoadResolvedBuildFixturesFromRoot(root string) (*Collection, error) {
	fixtureRoot := filepath.Join(
		root,
		"tests",
		"generic-swap-transaction-builder",
		"fixtures",
		"resolved-build",
	)

	manifest, err := loadManifest(root)
	if err != nil {
		return nil, err
	}

	fixtures, err := loadFixtureFiles(fixtureRoot)
	if err != nil {
		return nil, err
	}

	buckets, err := validateManifest(fixtures, manifest)
	if err != nil {
		return nil, err
	}

	return &Collection{
		RepoRoot:    root,
		FixtureRoot: fixtureRoot,
		Manifest:    manifest,
		Fixtures:    fixtures,
		Buckets:     buckets,
	}, nil
}

func (c *Collection) FixtureByName(name string) (Fixture, bool) {
	for _, fixture := range c.Fixtures {
		if fixture.Name == name {
			return fixture, true
		}
	}
	return Fixture{}, false
}

func ParseManifestJSON(raw []byte) (Manifest, error) {
	var parsed struct {
		SchemaVersion *int                       `json:"schemaVersion"`
		Buckets       map[Bucket][]ManifestEntry `json:"buckets"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Manifest{}, err
	}
	if parsed.SchemaVersion == nil {
		return Manifest{}, fmt.Errorf("manifest schemaVersion is required")
	}
	if *parsed.SchemaVersion != ManifestSchemaVersion {
		return Manifest{}, fmt.Errorf(
			"unsupported manifest schemaVersion %d; expected %d",
			*parsed.SchemaVersion,
			ManifestSchemaVersion,
		)
	}
	if parsed.Buckets == nil {
		return Manifest{}, fmt.Errorf("manifest buckets are required")
	}

	buckets := make(map[Bucket][]ManifestEntry, len(allBuckets))
	for _, bucket := range allBuckets {
		entries, ok := parsed.Buckets[bucket]
		if !ok {
			return Manifest{}, fmt.Errorf("manifest bucket %s is required", bucket)
		}
		buckets[bucket] = entries
	}
	for bucket := range parsed.Buckets {
		if !isValidBucket(bucket) {
			return Manifest{}, fmt.Errorf("unsupported manifest bucket %s", bucket)
		}
	}

	return Manifest{
		SchemaVersion: *parsed.SchemaVersion,
		Buckets:       buckets,
	}, nil
}

func loadManifest(root string) (Manifest, error) {
	raw, err := os.ReadFile(filepath.Join(
		root,
		"tests",
		"generic-swap-transaction-builder",
		"fixtures",
		"resolved-build-manifest.json",
	))
	if err != nil {
		return Manifest{}, err
	}
	return ParseManifestJSON(raw)
}

func loadFixtureFiles(fixtureRoot string) ([]Fixture, error) {
	var fixtures []Fixture
	seenPaths := make(map[string]struct{})
	seenNames := make(map[string]struct{})

	err := filepath.WalkDir(fixtureRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			return nil
		}

		relPath, err := filepath.Rel(fixtureRoot, path)
		if err != nil {
			return err
		}
		relPath = filepath.ToSlash(relPath)
		if _, ok := seenPaths[relPath]; ok {
			return fmt.Errorf("duplicate fixture path %s", relPath)
		}
		seenPaths[relPath] = struct{}{}

		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		fixture, err := parseFixture(raw, relPath)
		if err != nil {
			return err
		}
		if _, ok := seenNames[fixture.Name]; ok {
			return fmt.Errorf("duplicate fixture name %s", fixture.Name)
		}
		seenNames[fixture.Name] = struct{}{}
		fixtures = append(fixtures, fixture)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return fixtures, nil
}

func parseFixture(raw []byte, relPath string) (Fixture, error) {
	var parsed struct {
		SchemaVersion  *int             `json:"schemaVersion"`
		Name           string           `json:"name"`
		Kind           FixtureKind      `json:"kind"`
		Coverage       []string         `json:"coverage"`
		Input          *json.RawMessage `json:"input"`
		ExpectedParams *json.RawMessage `json:"expectedParams"`
		ExpectedTx     *json.RawMessage `json:"expectedTx"`
		ExpectedError  *string          `json:"expectedError"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Fixture{}, fmt.Errorf("%s: %w", relPath, err)
	}
	if parsed.SchemaVersion == nil {
		return Fixture{}, fmt.Errorf("%s: schemaVersion is required", relPath)
	}
	if *parsed.SchemaVersion != FixtureSchemaVersion {
		return Fixture{}, fmt.Errorf(
			"%s: unsupported schemaVersion %d; expected %d",
			relPath,
			*parsed.SchemaVersion,
			FixtureSchemaVersion,
		)
	}
	if parsed.Name == "" {
		return Fixture{}, fmt.Errorf("%s: name is required", relPath)
	}
	if parsed.Name != strings.TrimSuffix(filepath.Base(relPath), ".json") {
		return Fixture{}, fmt.Errorf("%s: name must match fixture file basename", relPath)
	}
	if !isValidKind(parsed.Kind) {
		return Fixture{}, fmt.Errorf("%s: unsupported kind %s", relPath, parsed.Kind)
	}
	if len(parsed.Coverage) == 0 {
		return Fixture{}, fmt.Errorf("%s: coverage must be non-empty", relPath)
	}
	if parsed.Input == nil {
		return Fixture{}, fmt.Errorf("%s: input is required", relPath)
	}
	if parsed.Kind == KindNegative {
		if parsed.ExpectedError == nil {
			return Fixture{}, fmt.Errorf("%s: expectedError is required", relPath)
		}
	} else {
		if parsed.ExpectedParams == nil {
			return Fixture{}, fmt.Errorf("%s: expectedParams is required", relPath)
		}
		if parsed.ExpectedTx == nil {
			return Fixture{}, fmt.Errorf("%s: expectedTx is required", relPath)
		}
	}

	fixture := Fixture{
		Path:          relPath,
		Raw:           raw,
		SchemaVersion: *parsed.SchemaVersion,
		Name:          parsed.Name,
		Kind:          parsed.Kind,
		Coverage:      parsed.Coverage,
		Input:         *parsed.Input,
	}
	if parsed.ExpectedParams != nil {
		fixture.ExpectedParams = *parsed.ExpectedParams
	}
	if parsed.ExpectedTx != nil {
		fixture.ExpectedTx = *parsed.ExpectedTx
	}
	if parsed.ExpectedError != nil {
		fixture.ExpectedError = *parsed.ExpectedError
	}

	return fixture, nil
}

func validateManifest(fixtures []Fixture, manifest Manifest) (map[Bucket][]Fixture, error) {
	byPath := make(map[string]Fixture, len(fixtures))
	for _, fixture := range fixtures {
		byPath[fixture.Path] = fixture
	}

	buckets := make(map[Bucket][]Fixture, len(allBuckets))
	seenPaths := make(map[string]struct{})
	for _, bucket := range allBuckets {
		for _, entry := range manifest.Buckets[bucket] {
			fixture, ok := byPath[entry.Path]
			if !ok {
				return nil, fmt.Errorf("manifest references missing fixture %s", entry.Path)
			}
			if entry.Name != fixture.Name {
				return nil, fmt.Errorf(
					"manifest name mismatch for %s: manifest %s, fixture %s",
					entry.Path,
					entry.Name,
					fixture.Name,
				)
			}
			if entry.Kind != fixture.Kind {
				return nil, fmt.Errorf(
					"manifest kind mismatch for %s: manifest %s, fixture %s",
					entry.Path,
					entry.Kind,
					fixture.Kind,
				)
			}
			if entry.SHA256 != sha256Hex(fixture.Raw) {
				return nil, fmt.Errorf("manifest hash mismatch for %s", entry.Path)
			}
			expectedBucket, err := expectedBucketForFixture(fixture)
			if err != nil {
				return nil, err
			}
			if bucket != expectedBucket {
				return nil, fmt.Errorf(
					"manifest bucket mismatch for %s: manifest %s, expected %s",
					entry.Path,
					bucket,
					expectedBucket,
				)
			}
			if _, ok := seenPaths[entry.Path]; ok {
				return nil, fmt.Errorf("duplicate manifest path %s", entry.Path)
			}
			seenPaths[entry.Path] = struct{}{}
			buckets[bucket] = append(buckets[bucket], fixture)
		}
	}
	for _, fixture := range fixtures {
		if _, ok := seenPaths[fixture.Path]; !ok {
			return nil, fmt.Errorf("fixture %s is missing from manifest", fixture.Path)
		}
	}

	return buckets, nil
}

func expectedBucketForFixture(fixture Fixture) (Bucket, error) {
	switch fixture.Kind {
	case KindGeneric:
		if !strings.HasPrefix(fixture.Path, "generic/") {
			return "", fmt.Errorf("%s: generic fixture must live under generic/", fixture.Path)
		}
		return BucketPhase2GenericSuccess, nil
	case KindDirect:
		if !strings.HasPrefix(fixture.Path, "direct/") {
			return "", fmt.Errorf("%s: direct fixture must live under direct/", fixture.Path)
		}
		return BucketPhase3DirectSuccess, nil
	case KindNegative:
		if !strings.HasPrefix(fixture.Path, "negative/") {
			return "", fmt.Errorf("%s: negative fixture must live under negative/", fixture.Path)
		}
		if inputHasRoutePlan(fixture.Input) {
			return BucketPhase2GenericNegative, nil
		}
		return BucketPhase3DirectNegative, nil
	default:
		return "", fmt.Errorf("%s: unsupported kind %s", fixture.Path, fixture.Kind)
	}
}

func inputHasRoutePlan(input json.RawMessage) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(input, &fields); err != nil {
		return false
	}
	_, ok := fields["routePlan"]
	return ok
}

func isValidKind(kind FixtureKind) bool {
	return kind == KindGeneric || kind == KindDirect || kind == KindNegative
}

func isValidBucket(bucket Bucket) bool {
	for _, candidate := range allBuckets {
		if bucket == candidate {
			return true
		}
	}
	return false
}

func sha256Hex(raw []byte) string {
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}
