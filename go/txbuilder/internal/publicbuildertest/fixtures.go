package publicbuildertest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
)

const FixtureSchemaVersion = 1

type FixtureKind string

const KindGenericPublic FixtureKind = "generic-public"

type Collection struct {
	RepoRoot    string
	FixtureRoot string
	Fixtures    []Fixture
}

type Fixture struct {
	Path string
	// Raw keeps the canonical JSON bytes available for fixture diagnostics.
	Raw                   []byte
	SchemaVersion         int
	Name                  string
	Kind                  FixtureKind
	DexKeys               []string
	Input                 FixtureInput
	ExpectedResolvedInput json.RawMessage
	ExpectedParams        json.RawMessage
	ExpectedTx            json.RawMessage
}

type FixtureInput struct {
	Request json.RawMessage `json:"request"`
	Options FixtureOptions  `json:"options"`
}

type FixtureOptions struct {
	SkipApprovalCheck bool `json:"skipApprovalCheck"`
}

type rawFixtureInput struct {
	Request *json.RawMessage   `json:"request"`
	Options *rawFixtureOptions `json:"options"`
}

type rawFixtureOptions struct {
	SkipApprovalCheck *bool `json:"skipApprovalCheck"`
}

func LoadPublicBuilderFixtures() (*Collection, error) {
	root, err := reporoot.Find()
	if err != nil {
		return nil, err
	}

	return LoadPublicBuilderFixturesFromRoot(root)
}

func LoadPublicBuilderFixturesFromRoot(root string) (*Collection, error) {
	fixtureRoot := filepath.Join(
		root,
		"tests",
		"generic-swap-transaction-builder",
		"fixtures",
		"go-public-builder",
	)

	fixtures, err := loadFixtureFiles(fixtureRoot)
	if err != nil {
		return nil, err
	}

	return &Collection{
		RepoRoot:    root,
		FixtureRoot: fixtureRoot,
		Fixtures:    fixtures,
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
		SchemaVersion         *int             `json:"schemaVersion"`
		Name                  string           `json:"name"`
		Kind                  FixtureKind      `json:"kind"`
		DexKeys               []string         `json:"dexKeys"`
		Input                 *rawFixtureInput `json:"input"`
		ExpectedResolvedInput *json.RawMessage `json:"expectedResolvedInput"`
		ExpectedParams        *json.RawMessage `json:"expectedParams"`
		ExpectedTx            *json.RawMessage `json:"expectedTx"`
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
	if parsed.Kind != KindGenericPublic {
		return Fixture{}, fmt.Errorf("%s: unsupported kind %s", relPath, parsed.Kind)
	}
	if len(parsed.DexKeys) == 0 {
		return Fixture{}, fmt.Errorf("%s: dexKeys must be non-empty", relPath)
	}
	if parsed.Input == nil {
		return Fixture{}, fmt.Errorf("%s: input is required", relPath)
	}
	if parsed.Input.Request == nil || len(*parsed.Input.Request) == 0 {
		return Fixture{}, fmt.Errorf("%s: input.request is required", relPath)
	}
	if parsed.Input.Options == nil {
		return Fixture{}, fmt.Errorf("%s: input.options is required", relPath)
	}
	if parsed.Input.Options.SkipApprovalCheck == nil {
		return Fixture{}, fmt.Errorf("%s: input.options.skipApprovalCheck is required", relPath)
	}
	if parsed.ExpectedResolvedInput == nil {
		return Fixture{}, fmt.Errorf("%s: expectedResolvedInput is required", relPath)
	}
	if parsed.ExpectedParams == nil {
		return Fixture{}, fmt.Errorf("%s: expectedParams is required", relPath)
	}
	if parsed.ExpectedTx == nil {
		return Fixture{}, fmt.Errorf("%s: expectedTx is required", relPath)
	}

	return Fixture{
		Path:          relPath,
		Raw:           raw,
		SchemaVersion: *parsed.SchemaVersion,
		Name:          parsed.Name,
		Kind:          parsed.Kind,
		DexKeys:       parsed.DexKeys,
		Input: FixtureInput{
			Request: *parsed.Input.Request,
			Options: FixtureOptions{
				SkipApprovalCheck: *parsed.Input.Options.SkipApprovalCheck,
			},
		},
		ExpectedResolvedInput: *parsed.ExpectedResolvedInput,
		ExpectedParams:        *parsed.ExpectedParams,
		ExpectedTx:            *parsed.ExpectedTx,
	}, nil
}
