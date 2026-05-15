package resolved

import "fmt"

func ValidateBuildDeps(input BuildInput, deps BuildDeps) error {
	if !IsSupportedExecutorType(input.ExecutorType) {
		return fmt.Errorf("unsupported executor type: %s", input.ExecutorType)
	}

	builderAddress := deps.EncodingContext.ExecutorsAddresses[input.ExecutorType]
	if input.ExecutorAddress != builderAddress {
		return fmt.Errorf(
			"executor address mismatch: input %s, builder %s",
			input.ExecutorAddress,
			builderAddress,
		)
	}

	if input.Network != deps.EncodingContext.Network {
		return fmt.Errorf(
			"network mismatch: input %d, context %d",
			input.Network,
			deps.EncodingContext.Network,
		)
	}

	if input.AugustusV6Address != deps.EncodingContext.AugustusV6Address {
		return fmt.Errorf(
			"augustusV6Address mismatch: input %s, context %s",
			input.AugustusV6Address,
			deps.EncodingContext.AugustusV6Address,
		)
	}

	if input.WrappedNativeTokenAddress != deps.EncodingContext.WrappedNativeTokenAddress {
		return fmt.Errorf(
			"wrappedNativeTokenAddress mismatch: input %s, context %s",
			input.WrappedNativeTokenAddress,
			deps.EncodingContext.WrappedNativeTokenAddress,
		)
	}

	return nil
}

func IsSupportedExecutorType(executorType ExecutorType) bool {
	return executorType == Executor01 ||
		executorType == Executor02 ||
		executorType == Executor03 ||
		executorType == ExecutorWETH
}

func IsGenericContractMethod(contractMethod string) bool {
	return contractMethod == ContractMethodSwapExactAmountIn ||
		contractMethod == ContractMethodSwapExactAmountOut ||
		contractMethod == ContractMethodSwapExactAmountInPro ||
		contractMethod == ContractMethodSwapExactAmountOutPro
}
