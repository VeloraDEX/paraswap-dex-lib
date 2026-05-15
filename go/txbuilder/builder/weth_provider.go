package builder

import (
	"context"
	"fmt"
	"math/big"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

const (
	wethDepositSelector  = "0xd0e30db0"
	wethWithdrawSelector = "0x2e1a7d4d"
)

type defaultWethProvider struct {
	wrappedNativeTokenAddress resolved.Address
}

func (p defaultWethProvider) GetDepositWithdrawCallData(
	_ context.Context,
	input WethCallDataInput,
) (*resolved.WethPlan, error) {
	plan := &resolved.WethPlan{}
	needsWithdraw := false

	if input.SrcAmountWeth != "0" {
		plan.Deposit = &resolved.WethSubPlan{
			Callee:   normalizeAddress(p.wrappedNativeTokenAddress),
			Calldata: wethDepositSelector,
			Value:    input.SrcAmountWeth,
		}
		if input.Side == resolved.SideBuy {
			needsWithdraw = true
		}
	}

	if needsWithdraw || input.DestAmountWeth != "0" {
		calldata, err := buildWethWithdrawCalldata(input.DestAmountWeth)
		if err != nil {
			return nil, err
		}
		plan.Withdraw = &resolved.WethSubPlan{
			Callee:   resolved.NullAddress,
			Calldata: calldata,
			Value:    "0",
		}
	}

	return plan, nil
}

func buildWethWithdrawCalldata(amount resolved.DecimalString) (resolved.HexBytes, error) {
	parsed, ok := new(big.Int).SetString(string(amount), 10)
	if !ok || parsed.Sign() < 0 {
		return "", fmt.Errorf("withdraw amount must be a non-negative decimal integer: %s", amount)
	}
	return resolved.HexBytes(wethWithdrawSelector + fmt.Sprintf("%064x", parsed)), nil
}
