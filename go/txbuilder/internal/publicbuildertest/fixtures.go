package publicbuildertest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
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
	Raw                      []byte
	SchemaVersion            int
	Name                     string
	Kind                     FixtureKind
	DexKeys                  []string
	Input                    FixtureInput
	ExpectedDexCalls         json.RawMessage
	ExpectedApprovalRequests json.RawMessage
	ApprovalDecisions        json.RawMessage
	ExpectedResolvedInput    json.RawMessage
	ExpectedParams           json.RawMessage
	ExpectedTx               json.RawMessage
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
		SchemaVersion            *int             `json:"schemaVersion"`
		Name                     string           `json:"name"`
		Kind                     FixtureKind      `json:"kind"`
		DexKeys                  []string         `json:"dexKeys"`
		Input                    *rawFixtureInput `json:"input"`
		ExpectedDexCalls         *json.RawMessage `json:"expectedDexCalls"`
		ExpectedApprovalRequests *json.RawMessage `json:"expectedApprovalRequests"`
		ApprovalDecisions        *json.RawMessage `json:"approvalDecisions"`
		ExpectedResolvedInput    *json.RawMessage `json:"expectedResolvedInput"`
		ExpectedParams           *json.RawMessage `json:"expectedParams"`
		ExpectedTx               *json.RawMessage `json:"expectedTx"`
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
	if parsed.ExpectedDexCalls == nil {
		return Fixture{}, fmt.Errorf("%s: expectedDexCalls is required", relPath)
	}
	if parsed.ExpectedApprovalRequests == nil {
		return Fixture{}, fmt.Errorf("%s: expectedApprovalRequests is required", relPath)
	}
	if parsed.ApprovalDecisions == nil {
		return Fixture{}, fmt.Errorf("%s: approvalDecisions is required", relPath)
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
		ExpectedDexCalls:         *parsed.ExpectedDexCalls,
		ExpectedApprovalRequests: *parsed.ExpectedApprovalRequests,
		ApprovalDecisions:        *parsed.ApprovalDecisions,
		ExpectedResolvedInput:    *parsed.ExpectedResolvedInput,
		ExpectedParams:           *parsed.ExpectedParams,
		ExpectedTx:               *parsed.ExpectedTx,
	}, nil
}

type ExpectedDexCall struct {
	RoutePositionKey    string                      `json:"routePositionKey"`
	DexKey              string                      `json:"dexKey"`
	NeedWrapNativeInput builder.NeedWrapNativeInput `json:"needWrapNativeInput"`
	NeedWrapNative      bool                        `json:"needWrapNative"`
	DexParamInput       builder.DexParamInput       `json:"dexParamInput"`
	DexParam            builder.DexExchangeParam    `json:"dexParam"`
}

type ExpectedApprovalRequest struct {
	RoutePositionKey string           `json:"routePositionKey"`
	Token            resolved.Address `json:"token"`
	Target           resolved.Address `json:"target"`
	Permit2          bool             `json:"permit2"`
}

func DecodeBuildRequest(fixture Fixture) (builder.BuildRequest, error) {
	var req builder.BuildRequest
	if err := json.Unmarshal(fixture.Input.Request, &req); err != nil {
		return builder.BuildRequest{}, err
	}
	return req, nil
}

func DecodeExpectedResolvedInput(fixture Fixture) (resolved.BuildInput, error) {
	var input resolved.BuildInput
	if err := json.Unmarshal(fixture.ExpectedResolvedInput, &input); err != nil {
		return resolved.BuildInput{}, err
	}
	return input, nil
}

func DecodeExpectedDexCalls(fixture Fixture) ([]ExpectedDexCall, error) {
	var calls []ExpectedDexCall
	if err := json.Unmarshal(fixture.ExpectedDexCalls, &calls); err != nil {
		return nil, err
	}
	return calls, nil
}

func DecodeExpectedApprovalRequests(fixture Fixture) ([]ExpectedApprovalRequest, error) {
	var requests []ExpectedApprovalRequest
	if err := json.Unmarshal(fixture.ExpectedApprovalRequests, &requests); err != nil {
		return nil, err
	}
	return requests, nil
}

func DecodeApprovalDecisions(fixture Fixture) ([]bool, error) {
	var decisions []bool
	if err := json.Unmarshal(fixture.ApprovalDecisions, &decisions); err != nil {
		return nil, err
	}
	return decisions, nil
}

func DecodeExpectedParams(fixture Fixture) ([]any, error) {
	var params []any
	decoder := json.NewDecoder(bytes.NewReader(fixture.ExpectedParams))
	decoder.UseNumber()
	if err := decoder.Decode(&params); err != nil {
		return nil, err
	}
	return params, nil
}

func DecodeExpectedTx(fixture Fixture) (resolved.TxObject, error) {
	var tx resolved.TxObject
	if err := json.Unmarshal(fixture.ExpectedTx, &tx); err != nil {
		return resolved.TxObject{}, err
	}
	return tx, nil
}

type FixtureDexRegistry struct {
	Expected []ExpectedDexCall
	next     int
}

func NewFixtureDexRegistry(expected []ExpectedDexCall) *FixtureDexRegistry {
	return &FixtureDexRegistry{Expected: expected}
}

func (r *FixtureDexRegistry) GetDexEncoder(_ context.Context, network int, dexKey string) (builder.DexEncoder, error) {
	if r.next >= len(r.Expected) {
		return nil, fmt.Errorf("unexpected DEX lookup for %s", dexKey)
	}
	expected := r.Expected[r.next]
	if expected.NeedWrapNativeInput.Route.Network != network {
		return nil, fmt.Errorf(
			"%s: network mismatch: got %d want %d",
			expected.RoutePositionKey,
			network,
			expected.NeedWrapNativeInput.Route.Network,
		)
	}
	if expected.DexKey != dexKey {
		return nil, fmt.Errorf(
			"%s: dexKey mismatch: got %s want %s",
			expected.RoutePositionKey,
			dexKey,
			expected.DexKey,
		)
	}
	r.next++
	return &fixtureDexEncoder{expected: expected}, nil
}

func (r *FixtureDexRegistry) AssertConsumed() error {
	if r.next != len(r.Expected) {
		return fmt.Errorf("consumed %d DEX calls; expected %d", r.next, len(r.Expected))
	}
	return nil
}

type fixtureDexEncoder struct {
	expected ExpectedDexCall
}

func (e *fixtureDexEncoder) NeedWrapNative(_ context.Context, input builder.NeedWrapNativeInput) (bool, error) {
	if !jsonEquivalent(input, e.expected.NeedWrapNativeInput) {
		return false, fmt.Errorf(
			"%s: needWrapNative input mismatch\n got: %s\nwant: %s",
			e.expected.RoutePositionKey,
			mustJSON(input),
			mustJSON(e.expected.NeedWrapNativeInput),
		)
	}
	return e.expected.NeedWrapNative, nil
}

func (e *fixtureDexEncoder) GetDexParam(_ context.Context, input builder.DexParamInput) (builder.DexExchangeParam, error) {
	if !jsonEquivalent(input, e.expected.DexParamInput) {
		return builder.DexExchangeParam{}, fmt.Errorf(
			"%s: dex param input mismatch\n got: %s\nwant: %s",
			e.expected.RoutePositionKey,
			mustJSON(input),
			mustJSON(e.expected.DexParamInput),
		)
	}
	return e.expected.DexParam, nil
}

type FixtureApprovalChecker struct {
	Expected        []ExpectedApprovalRequest
	Decisions       []bool
	ExpectedSpender resolved.Address
	Called          bool
}

func (c *FixtureApprovalChecker) Check(_ context.Context, spender resolved.Address, requests []builder.ApprovalRequest) ([]bool, error) {
	c.Called = true
	if spender != c.ExpectedSpender {
		return nil, fmt.Errorf("approval spender mismatch: got %s want %s", spender, c.ExpectedSpender)
	}
	if len(requests) != len(c.Expected) {
		return nil, fmt.Errorf("approval request count mismatch: got %d want %d", len(requests), len(c.Expected))
	}
	for index, request := range requests {
		expected := c.Expected[index]
		if request.RoutePositionKey != expected.RoutePositionKey ||
			request.Token != expected.Token ||
			request.Target != expected.Target ||
			request.Permit2 != expected.Permit2 {
			return nil, fmt.Errorf("approval request %d mismatch", index)
		}
	}
	return append([]bool(nil), c.Decisions...), nil
}

func mustJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("<json error: %v>", err)
	}
	return string(raw)
}

func jsonEquivalent(a, b any) bool {
	aRaw, err := json.Marshal(a)
	if err != nil {
		return false
	}
	bRaw, err := json.Marshal(b)
	if err != nil {
		return false
	}
	var aValue any
	aDecoder := json.NewDecoder(bytes.NewReader(aRaw))
	aDecoder.UseNumber()
	if err := aDecoder.Decode(&aValue); err != nil {
		return false
	}
	var bValue any
	bDecoder := json.NewDecoder(bytes.NewReader(bRaw))
	bDecoder.UseNumber()
	if err := bDecoder.Decode(&bValue); err != nil {
		return false
	}
	return reflect.DeepEqual(aValue, bValue)
}
