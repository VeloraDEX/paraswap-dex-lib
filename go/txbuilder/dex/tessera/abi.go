package tessera

import (
	"bytes"
	_ "embed"
	"fmt"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
)

//go:embed abi/tessera_swap.json
var tesseraSwapABIJSON []byte

func TesseraSwapABIBytes() []byte {
	out := make([]byte, len(tesseraSwapABIJSON))
	copy(out, tesseraSwapABIJSON)
	return out
}

func LoadTesseraSwapABI() (*ethabi.ABI, error) {
	parsed, err := ethabi.JSON(bytes.NewReader(tesseraSwapABIJSON))
	if err != nil {
		return nil, fmt.Errorf("parse Tessera swap ABI: %w", err)
	}
	return &parsed, nil
}

func MustLoadTesseraSwapABI() *ethabi.ABI {
	parsed, err := LoadTesseraSwapABI()
	if err != nil {
		panic(err)
	}
	return parsed
}
