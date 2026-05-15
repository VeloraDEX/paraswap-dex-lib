package resolved

import "fmt"

func BuildTransactionFromResolved(input BuildInput, deps BuildDeps) (BuildOutput, error) {
	validated, err := validateBuildInput(input, deps)
	if err != nil {
		return BuildOutput{}, err
	}

	if deps.ExecutorBytecodeBuilderFactory == nil {
		return BuildOutput{}, fmt.Errorf("executor bytecode builder factory is required")
	}

	bytecodeBuilder, err := deps.ExecutorBytecodeBuilderFactory.CreateExecutorBytecodeBuilder(
		input.ExecutorType,
		deps.EncodingContext,
	)
	if err != nil {
		return BuildOutput{}, err
	}
	if bytecodeBuilder == nil {
		return BuildOutput{}, fmt.Errorf("executor bytecode builder is required")
	}

	bytecode, err := bytecodeBuilder.BuildBytecode(ExecutorBytecodeBuildInput{
		ExecutorType: input.ExecutorType,
		Context:      deps.EncodingContext,
		RoutePlan:    validated.routePlan,
		ResolvedLegs: validated.resolvedLegs,
		Sender:       input.UserAddress,
		SrcToken:     input.SrcToken,
		DestToken:    input.DestToken,
		DestAmount:   input.DestAmount,
		WethPlan:     validated.wethPlan,
	})
	if err != nil {
		return BuildOutput{}, err
	}

	params, err := BuildGenericSwapParams(input, validated.fee, string(bytecode))
	if err != nil {
		return BuildOutput{}, err
	}

	data, err := encodeGenericCalldata(input, validated.fee, bytecode, deps.AugustusV6ABI)
	if err != nil {
		return BuildOutput{}, err
	}

	value, err := BuildTxValue(input)
	if err != nil {
		return BuildOutput{}, err
	}

	txObject := TxObject{
		From:                 input.UserAddress,
		To:                   input.AugustusV6Address,
		Value:                DecimalString(value),
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

	return BuildOutput{
		Params:   params,
		TxObject: txObject,
	}, nil
}
