package resolvedtest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

const depsSchemaVersion = 1

var (
	augustusV6ABIOnce sync.Once
	augustusV6ABI     *ethabi.ABI
	augustusV6ABIErr  error
)

type depsContract struct {
	SchemaVersion      int
	ExecutorsAddresses map[resolved.ExecutorType]resolved.Address
}

func BuildDepsFromFixtureInput(input resolved.BuildInput) (resolved.BuildDeps, error) {
	root, err := reporoot.Find()
	if err != nil {
		return resolved.BuildDeps{}, err
	}

	contract, err := loadDepsContract(root)
	if err != nil {
		return resolved.BuildDeps{}, err
	}

	augustusABI, err := loadAugustusV6ABICached()
	if err != nil {
		return resolved.BuildDeps{}, err
	}

	executorsAddresses := map[resolved.ExecutorType]resolved.Address{
		resolved.Executor01:   contract.ExecutorsAddresses[resolved.Executor01],
		resolved.Executor02:   contract.ExecutorsAddresses[resolved.Executor02],
		resolved.Executor03:   contract.ExecutorsAddresses[resolved.Executor03],
		resolved.ExecutorWETH: input.WrappedNativeTokenAddress,
	}

	return resolved.BuildDeps{
		EncodingContext: resolved.EncodingContext{
			Network:                   input.Network,
			AugustusV6Address:         input.AugustusV6Address,
			WrappedNativeTokenAddress: input.WrappedNativeTokenAddress,
			ExecutorsAddresses:        executorsAddresses,
		},
		AugustusV6ABI: augustusABI,
	}, nil
}

func BuildDirectDepsFromFixtureInput(_ resolved.DirectBuildInput) (resolved.DirectBuildDeps, error) {
	augustusABI, err := loadAugustusV6ABICached()
	if err != nil {
		return resolved.DirectBuildDeps{}, err
	}
	return resolved.DirectBuildDeps{
		AugustusV6ABI: augustusABI,
	}, nil
}

func loadAugustusV6ABICached() (*ethabi.ABI, error) {
	augustusV6ABIOnce.Do(func() {
		augustusV6ABI, augustusV6ABIErr = resolved.LoadAugustusV6ABI()
	})
	return augustusV6ABI, augustusV6ABIErr
}

func loadDepsContract(root string) (depsContract, error) {
	raw, err := os.ReadFile(filepath.Join(
		root,
		"tests",
		"generic-swap-transaction-builder",
		"fixtures",
		"resolved-build-deps-contract.json",
	))
	if err != nil {
		return depsContract{}, err
	}

	return parseDepsContractJSON(raw)
}

func parseDepsContractJSON(raw []byte) (depsContract, error) {
	var parsed struct {
		SchemaVersion      *int                                       `json:"schemaVersion"`
		ExecutorsAddresses map[resolved.ExecutorType]resolved.Address `json:"executorsAddresses"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return depsContract{}, err
	}
	if parsed.SchemaVersion == nil {
		return depsContract{}, fmt.Errorf("deps schemaVersion is required")
	}
	if *parsed.SchemaVersion != depsSchemaVersion {
		return depsContract{}, fmt.Errorf(
			"unsupported deps schemaVersion %d; expected %d",
			*parsed.SchemaVersion,
			depsSchemaVersion,
		)
	}
	if parsed.ExecutorsAddresses == nil {
		return depsContract{}, fmt.Errorf("deps executorsAddresses are required")
	}

	for _, executor := range []resolved.ExecutorType{
		resolved.Executor01,
		resolved.Executor02,
		resolved.Executor03,
	} {
		if parsed.ExecutorsAddresses[executor] == "" {
			return depsContract{}, fmt.Errorf("deps executor address %s is required", executor)
		}
	}

	return depsContract{
		SchemaVersion:      *parsed.SchemaVersion,
		ExecutorsAddresses: parsed.ExecutorsAddresses,
	}, nil
}
