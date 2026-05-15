package resolved

import "fmt"

func BuildTxValue(input BuildInput) (string, error) {
	switch input.Side {
	case SideSell:
		if input.SrcToken != NativeTokenAddress {
			return "0", nil
		}
		return string(input.SrcAmount), nil
	case SideBuy:
		if input.SrcToken != NativeTokenAddress {
			return "0", nil
		}
		return string(input.MinMaxAmount), nil
	default:
		return "", fmt.Errorf("side must be SELL or BUY: %s", input.Side)
	}
}
