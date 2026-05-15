package resolved

import (
	"bytes"
	_ "embed"
	"fmt"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
)

//go:embed abi/augustus_v6.json
var augustusV6ABIJSON []byte

func AugustusV6ABIBytes() []byte {
	out := make([]byte, len(augustusV6ABIJSON))
	copy(out, augustusV6ABIJSON)
	return out
}

func LoadAugustusV6ABI() (*ethabi.ABI, error) {
	parsed, err := ethabi.JSON(bytes.NewReader(augustusV6ABIJSON))
	if err != nil {
		return nil, fmt.Errorf("parse Augustus V6 ABI: %w", err)
	}
	return &parsed, nil
}

func MustLoadAugustusV6ABI() *ethabi.ABI {
	parsed, err := LoadAugustusV6ABI()
	if err != nil {
		panic(err)
	}
	return parsed
}
