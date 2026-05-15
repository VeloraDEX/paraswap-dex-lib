package registry

import (
	"context"
	"fmt"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
)

type Entry struct {
	Keys    []string
	Encoder builder.DexEncoder
}

type Registry struct {
	encoders map[string]builder.DexEncoder
}

func New(entries ...Entry) (*Registry, error) {
	encoders := make(map[string]builder.DexEncoder)

	for entryIndex, entry := range entries {
		if len(entry.Keys) == 0 {
			return nil, fmt.Errorf("dex registry entry %d must have at least one key", entryIndex)
		}
		if entry.Encoder == nil {
			return nil, fmt.Errorf("dex registry entry %d encoder is required", entryIndex)
		}
		for _, key := range entry.Keys {
			if key == "" {
				return nil, fmt.Errorf("dex registry entry %d key must be non-empty", entryIndex)
			}
			if _, exists := encoders[key]; exists {
				return nil, fmt.Errorf("duplicate dex registry key %q", key)
			}
			encoders[key] = entry.Encoder
		}
	}

	return &Registry{encoders: encoders}, nil
}

func MustNew(entries ...Entry) *Registry {
	registry, err := New(entries...)
	if err != nil {
		panic(err)
	}
	return registry
}

func (r *Registry) GetDexEncoder(_ context.Context, network int, dexKey string) (builder.DexEncoder, error) {
	if r == nil {
		return nil, fmt.Errorf("dex encoder registry is nil for %s on network %d", dexKey, network)
	}
	encoder, ok := r.encoders[dexKey]
	if !ok {
		return nil, fmt.Errorf("dex encoder not found for %s on network %d", dexKey, network)
	}
	return encoder, nil
}
