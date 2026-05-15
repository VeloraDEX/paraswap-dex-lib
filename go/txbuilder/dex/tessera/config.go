package tessera

import (
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

const (
	NetworkBSC  = 56
	NetworkBase = 8453
)

type Config struct {
	RouterByNetwork        map[int]resolved.Address
	WrappedNativeByNetwork map[int]resolved.Address
}

func DefaultConfig() Config {
	return Config{
		RouterByNetwork: map[int]resolved.Address{
			NetworkBase: "0x55555522005bcae1c2424d474bfd5ed477749e3e",
			NetworkBSC:  "0x55555522005bcae1c2424d474bfd5ed477749e3e",
		},
		WrappedNativeByNetwork: map[int]resolved.Address{
			NetworkBase: "0x4200000000000000000000000000000000000006",
			NetworkBSC:  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
		},
	}
}

func normalizeConfig(config Config) Config {
	return Config{
		RouterByNetwork:        normalizeAddressMap(config.RouterByNetwork),
		WrappedNativeByNetwork: normalizeAddressMap(config.WrappedNativeByNetwork),
	}
}

func normalizeAddressMap(input map[int]resolved.Address) map[int]resolved.Address {
	if input == nil {
		return nil
	}
	out := make(map[int]resolved.Address, len(input))
	for network, address := range input {
		out[network] = resolved.Address(strings.ToLower(string(address)))
	}
	return out
}
