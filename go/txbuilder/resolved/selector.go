package resolved

import (
	"encoding/hex"
	"fmt"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
)

func AugustusV6MethodSelector(augustusV6ABI *ethabi.ABI, contractMethod string) (string, error) {
	if augustusV6ABI == nil {
		return "", fmt.Errorf("Augustus V6 ABI is required")
	}

	method, ok := augustusV6ABI.Methods[contractMethod]
	if !ok {
		return "", fmt.Errorf("Augustus V6 method not found: %s", contractMethod)
	}

	return "0x" + hex.EncodeToString(method.ID), nil
}
