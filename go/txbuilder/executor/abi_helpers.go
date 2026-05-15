package executor

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

var erc20ABI = mustParseABI(`[{"type":"function","name":"transfer","inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}]}]`)

func mustParseABI(raw string) ethabi.ABI {
	parsed, err := ethabi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}

func buildERC20TransferCalldata(to resolved.Address, amount resolved.DecimalString) (resolved.HexBytes, error) {
	parsedAmount, ok := new(big.Int).SetString(string(amount), 10)
	if !ok || parsedAmount.Sign() < 0 {
		return "", fmt.Errorf("transfer amount must be a non-negative decimal integer: %s", amount)
	}

	packed, err := erc20ABI.Pack("transfer", common.HexToAddress(string(to)), parsedAmount)
	if err != nil {
		return "", err
	}
	return resolved.HexBytes("0x" + hex.EncodeToString(packed)), nil
}
