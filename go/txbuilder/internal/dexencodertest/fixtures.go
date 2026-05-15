package dexencodertest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
)

const FixtureSchemaVersion = 1

type FixtureKind string

const (
	KindNeedWrapNative FixtureKind = "need-wrap-native"
	KindDexParam       FixtureKind = "dex-param"
	KindDirectParam    FixtureKind = "direct-param"
)

type Collection struct {
	RepoRoot    string
	FixtureRoot string
	Fixtures    []Fixture
}

type Fixture struct {
	Path          string
	Raw           []byte
	SchemaVersion int
	Name          string
	Kind          FixtureKind
	Network       int
	DexKey        string
	Input         json.RawMessage
	Expected      json.RawMessage
}

func LoadTesseraFixtures(kind FixtureKind) (*Collection, error) {
	root, err := reporoot.Find()
	if err != nil {
		return nil, err
	}
	return LoadTesseraFixturesFromRoot(root, kind)
}

func LoadTesseraFixturesFromRoot(root string, kind FixtureKind) (*Collection, error) {
	fixtureRoot := filepath.Join(
		root,
		"tests",
		"generic-swap-transaction-builder",
		"dex-encoder",
		"fixtures",
	)

	fixtures, err := loadFixtureFiles(fixtureRoot, kind)
	if err != nil {
		return nil, err
	}

	return &Collection{
		RepoRoot:    root,
		FixtureRoot: fixtureRoot,
		Fixtures:    fixtures,
	}, nil
}

func loadFixtureFiles(fixtureRoot string, kind FixtureKind) ([]Fixture, error) {
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
		if fixture.Kind != kind || fixture.DexKey != "tessera" {
			return nil
		}
		if _, ok := seenNames[fixture.Name]; ok {
			return fmt.Errorf("duplicate Tessera fixture name %s", fixture.Name)
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
		SchemaVersion *int             `json:"schemaVersion"`
		Name          string           `json:"name"`
		Kind          FixtureKind      `json:"kind"`
		Network       *int             `json:"network"`
		DexKey        string           `json:"dexKey"`
		Input         *json.RawMessage `json:"input"`
		Expected      *json.RawMessage `json:"expected"`
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
	if parsed.Kind != KindNeedWrapNative && parsed.Kind != KindDexParam && parsed.Kind != KindDirectParam {
		return Fixture{}, fmt.Errorf("%s: unsupported kind %s", relPath, parsed.Kind)
	}
	if parsed.Network == nil {
		return Fixture{}, fmt.Errorf("%s: network is required", relPath)
	}
	if parsed.DexKey == "" {
		return Fixture{}, fmt.Errorf("%s: dexKey is required", relPath)
	}
	if parsed.Input == nil {
		return Fixture{}, fmt.Errorf("%s: input is required", relPath)
	}
	if parsed.Expected == nil {
		return Fixture{}, fmt.Errorf("%s: expected is required", relPath)
	}

	return Fixture{
		Path:          relPath,
		Raw:           raw,
		SchemaVersion: *parsed.SchemaVersion,
		Name:          parsed.Name,
		Kind:          parsed.Kind,
		Network:       *parsed.Network,
		DexKey:        parsed.DexKey,
		Input:         *parsed.Input,
		Expected:      *parsed.Expected,
	}, nil
}

func DecodeNeedWrapNativeInput(fixture Fixture) (builder.NeedWrapNativeInput, error) {
	var input builder.NeedWrapNativeInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		return builder.NeedWrapNativeInput{}, err
	}
	return input, nil
}

func DecodeDexParamInput(fixture Fixture) (builder.DexParamInput, error) {
	var input builder.DexParamInput
	if err := json.Unmarshal(fixture.Input, &input); err != nil {
		return builder.DexParamInput{}, err
	}
	return input, nil
}

func DecodeExpectedBool(fixture Fixture) (bool, error) {
	var expected bool
	if err := json.Unmarshal(fixture.Expected, &expected); err != nil {
		return false, err
	}
	return expected, nil
}

func DecodeExpectedDexExchangeParam(fixture Fixture) (builder.DexExchangeParam, error) {
	var expected builder.DexExchangeParam
	if err := json.Unmarshal(fixture.Expected, &expected); err != nil {
		return builder.DexExchangeParam{}, err
	}
	return expected, nil
}
