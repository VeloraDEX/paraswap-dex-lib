package resolved

func BuildDirectTransactionFromResolved(
	input DirectBuildInput,
	deps DirectBuildDeps,
) (DirectBuildOutput, error) {
	validatedParams, err := validateDirectBuildInput(input)
	if err != nil {
		return DirectBuildOutput{}, err
	}

	outputParams, err := ParseDirectParamsForOutput(input.Params)
	if err != nil {
		return DirectBuildOutput{}, err
	}

	data, err := encodeDirectCalldata(input, validatedParams, deps.AugustusV6ABI)
	if err != nil {
		return DirectBuildOutput{}, err
	}

	txObject := TxObject{
		From:                 input.UserAddress,
		To:                   input.AugustusV6Address,
		Value:                directTxValue(input),
		Data:                 data,
		GasPrice:             "",
		MaxFeePerGas:         "",
		MaxPriorityFeePerGas: "",
	}
	if input.Gas != nil {
		txObject.GasPrice = input.Gas.GasPrice
		txObject.MaxFeePerGas = input.Gas.MaxFeePerGas
		txObject.MaxPriorityFeePerGas = input.Gas.MaxPriorityFeePerGas
	}

	return DirectBuildOutput{
		ContractMethod: input.ContractMethod,
		Params:         outputParams,
		TxObject:       txObject,
	}, nil
}

func directTxValue(input DirectBuildInput) DecimalString {
	if input.SrcToken != NativeTokenAddress {
		return "0"
	}
	if input.Side == SideSell {
		return input.SrcAmount
	}
	return input.MinMaxAmount
}
