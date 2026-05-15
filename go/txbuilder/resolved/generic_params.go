package resolved

import "fmt"

func BuildGenericSwapParams(input BuildInput, fee FeeInput, bytecode string) ([]any, error) {
	if !IsGenericContractMethod(input.ContractMethod) {
		return nil, fmt.Errorf(
			"unsupported generic contract method for resolved build: %s",
			input.ContractMethod,
		)
	}

	partnerAndFee, err := BuildFeesV6(fee)
	if err != nil {
		return nil, err
	}

	metadata, err := PackUUIDAndBlock(input.UUID, input.BlockNumber)
	if err != nil {
		return nil, err
	}

	var fromAmount DecimalString
	var toAmount DecimalString
	switch input.Side {
	case SideSell:
		fromAmount = input.SrcAmount
		toAmount = input.MinMaxAmount
	case SideBuy:
		fromAmount = input.MinMaxAmount
		toAmount = input.DestAmount
	default:
		return nil, fmt.Errorf("side must be SELL or BUY: %s", input.Side)
	}

	return []any{
		string(input.ExecutorAddress),
		[]any{
			string(input.SrcToken),
			string(input.DestToken),
			string(fromAmount),
			string(toAmount),
			string(input.QuotedAmount),
			metadata,
			string(input.Beneficiary),
		},
		partnerAndFee.String(),
		string(input.Permit),
		bytecode,
	}, nil
}
