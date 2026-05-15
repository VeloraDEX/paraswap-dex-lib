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

var erc20ABI = mustParseABI(`[
	{"type":"function","name":"transfer","inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}]},
	{"type":"function","name":"approve","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}]},
	{"type":"function","name":"withdraw","inputs":[{"name":"wad","type":"uint256"}],"outputs":[]},
	{"type":"function","name":"deposit","inputs":[],"outputs":[]}
]`)

var permit2ABI = mustParseABI(`[
	{"type":"function","name":"approve","inputs":[{"name":"token","type":"address"},{"name":"spender","type":"address"},{"name":"amount","type":"uint160"},{"name":"expiration","type":"uint48"}],"outputs":[]}
]`)

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

func buildERC20ApproveCalldata(spender resolved.Address, amount resolved.DecimalString) (resolved.HexBytes, error) {
	parsedAmount, ok := new(big.Int).SetString(string(amount), 10)
	if !ok || parsedAmount.Sign() < 0 {
		return "", fmt.Errorf("approve amount must be a non-negative decimal integer: %s", amount)
	}

	packed, err := erc20ABI.Pack("approve", common.HexToAddress(string(spender)), parsedAmount)
	if err != nil {
		return "", err
	}
	return resolved.HexBytes("0x" + hex.EncodeToString(packed)), nil
}

func buildERC20WithdrawCalldata(amount resolved.DecimalString) (resolved.HexBytes, error) {
	parsedAmount, ok := new(big.Int).SetString(string(amount), 10)
	if !ok || parsedAmount.Sign() < 0 {
		return "", fmt.Errorf("withdraw amount must be a non-negative decimal integer: %s", amount)
	}

	packed, err := erc20ABI.Pack("withdraw", parsedAmount)
	if err != nil {
		return "", err
	}
	return resolved.HexBytes("0x" + hex.EncodeToString(packed)), nil
}

func buildERC20DepositCalldata() (resolved.HexBytes, error) {
	packed, err := erc20ABI.Pack("deposit")
	if err != nil {
		return "", err
	}
	return resolved.HexBytes("0x" + hex.EncodeToString(packed)), nil
}

func buildPermit2ApproveCalldata(
	token resolved.Address,
	spender resolved.Address,
	amount resolved.DecimalString,
	expiration resolved.DecimalString,
) (resolved.HexBytes, error) {
	parsedAmount, ok := new(big.Int).SetString(string(amount), 10)
	if !ok || parsedAmount.Sign() < 0 {
		return "", fmt.Errorf("permit2 amount must be a non-negative decimal integer: %s", amount)
	}
	parsedExpiration, ok := new(big.Int).SetString(string(expiration), 10)
	if !ok || parsedExpiration.Sign() < 0 {
		return "", fmt.Errorf("permit2 expiration must be a non-negative decimal integer: %s", expiration)
	}

	packed, err := permit2ABI.Pack(
		"approve",
		common.HexToAddress(string(token)),
		common.HexToAddress(string(spender)),
		parsedAmount,
		parsedExpiration,
	)
	if err != nil {
		return "", err
	}
	return resolved.HexBytes("0x" + hex.EncodeToString(packed)), nil
}
