package registry_test

import (
	"context"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/dex/registry"
)

func TestRegistryAliasLookup(t *testing.T) {
	encoder := fakeEncoder{}
	reg := registry.MustNew(registry.Entry{
		Keys:    []string{"tessera", "Tessera"},
		Encoder: encoder,
	})

	for _, key := range []string{"tessera", "Tessera"} {
		t.Run(key, func(t *testing.T) {
			got, err := reg.GetDexEncoder(context.Background(), 8453, key)
			if err != nil {
				t.Fatal(err)
			}
			if got != encoder {
				t.Fatalf("encoder mismatch: got %#v want %#v", got, encoder)
			}
		})
	}

	if _, err := reg.GetDexEncoder(context.Background(), 8453, "TESSERA"); err == nil ||
		!strings.Contains(err.Error(), "dex encoder not found for TESSERA on network 8453") {
		t.Fatalf("expected exact-key miss, got %v", err)
	}
}

func TestRegistryRejectsInvalidEntries(t *testing.T) {
	tests := []struct {
		name    string
		entries []registry.Entry
		want    string
	}{
		{
			name: "empty key list",
			entries: []registry.Entry{{
				Encoder: fakeEncoder{},
			}},
			want: "must have at least one key",
		},
		{
			name: "nil encoder",
			entries: []registry.Entry{{
				Keys: []string{"tessera"},
			}},
			want: "encoder is required",
		},
		{
			name: "empty key",
			entries: []registry.Entry{{
				Keys:    []string{""},
				Encoder: fakeEncoder{},
			}},
			want: "key must be non-empty",
		},
		{
			name: "duplicate key",
			entries: []registry.Entry{
				{Keys: []string{"tessera"}, Encoder: fakeEncoder{}},
				{Keys: []string{"tessera"}, Encoder: fakeEncoder{}},
			},
			want: "duplicate dex registry key \"tessera\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := registry.New(tt.entries...)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}
}

type fakeEncoder struct{}

var _ builder.DexEncoder = fakeEncoder{}

func (fakeEncoder) NeedWrapNative(context.Context, builder.NeedWrapNativeInput) (bool, error) {
	return false, nil
}

func (fakeEncoder) GetDexParam(context.Context, builder.DexParamInput) (builder.DexExchangeParam, error) {
	return builder.DexExchangeParam{}, nil
}
