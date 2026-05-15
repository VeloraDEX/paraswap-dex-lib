package resolved

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type directContractMethodSpec struct {
	side    Side
	hasSide bool
}

var directContractMethods = map[string]directContractMethodSpec{
	ContractMethodSwapExactAmountInOnUniswapV2:   {side: SideSell, hasSide: true},
	ContractMethodSwapExactAmountOutOnUniswapV2:  {side: SideBuy, hasSide: true},
	ContractMethodSwapExactAmountInOnUniswapV3:   {side: SideSell, hasSide: true},
	ContractMethodSwapExactAmountOutOnUniswapV3:  {side: SideBuy, hasSide: true},
	ContractMethodSwapExactAmountInOnBalancerV2:  {side: SideSell, hasSide: true},
	ContractMethodSwapExactAmountOutOnBalancerV2: {side: SideBuy, hasSide: true},
	ContractMethodSwapExactAmountInOnCurveV1:     {side: SideSell, hasSide: true},
	ContractMethodSwapExactAmountInOnCurveV2:     {side: SideSell, hasSide: true},
	ContractMethodSwapOnAugustusRFQTryBatchFill:  {},
	ContractMethodSwapExactAmountInOutOnMakerPSM: {},
}

func validateDirectBuildInput(input DirectBuildInput) ([]json.RawMessage, error) {
	if err := validateSupportedDirectContractMethod(input.ContractMethod); err != nil {
		return nil, err
	}
	if err := validateDirectSide(input.Side); err != nil {
		return nil, err
	}
	if err := validateDirectSideContractMethod(input.ContractMethod, input.Side); err != nil {
		return nil, err
	}
	return validateDirectTopLevelFields(input)
}

func validateSupportedDirectContractMethod(contractMethod string) error {
	if !IsDirectContractMethod(contractMethod) {
		return fmt.Errorf("unsupported direct contract method for resolved build: %s", contractMethod)
	}
	return nil
}

func IsDirectContractMethod(contractMethod string) bool {
	_, ok := directContractMethods[contractMethod]
	return ok
}

func validateDirectSide(side Side) error {
	if side != SideSell && side != SideBuy {
		return fmt.Errorf("direct side must be SELL or BUY: %s", side)
	}
	return nil
}

func validateDirectSideContractMethod(contractMethod string, side Side) error {
	spec, ok := directContractMethods[contractMethod]
	if !ok || !spec.hasSide {
		return nil
	}
	if side != spec.side {
		return fmt.Errorf(
			"direct contract method %s is inconsistent with side %s; expected %s",
			contractMethod,
			side,
			spec.side,
		)
	}
	return nil
}

func validateDirectTopLevelFields(input DirectBuildInput) ([]json.RawMessage, error) {
	params, err := parseDirectParamArray(input.Params)
	if err != nil {
		return nil, err
	}
	if err := assertLowercaseAddress(input.UserAddress, "userAddress"); err != nil {
		return nil, err
	}
	if err := assertLowercaseAddress(input.AugustusV6Address, "augustusV6Address"); err != nil {
		return nil, err
	}
	if err := assertLowercaseAddress(input.SrcToken, "srcToken"); err != nil {
		return nil, err
	}
	if err := assertDecimalAmountString(input.SrcAmount, "srcAmount"); err != nil {
		return nil, err
	}
	if err := assertDecimalAmountString(input.MinMaxAmount, "minMaxAmount"); err != nil {
		return nil, err
	}
	if input.Gas != nil {
		if input.Gas.GasPrice != "" {
			if err := assertDecimalAmountString(input.Gas.GasPrice, "gas.gasPrice"); err != nil {
				return nil, err
			}
		}
		if input.Gas.MaxFeePerGas != "" {
			if err := assertDecimalAmountString(input.Gas.MaxFeePerGas, "gas.maxFeePerGas"); err != nil {
				return nil, err
			}
		}
		if input.Gas.MaxPriorityFeePerGas != "" {
			if err := assertDecimalAmountString(input.Gas.MaxPriorityFeePerGas, "gas.maxPriorityFeePerGas"); err != nil {
				return nil, err
			}
		}
	}
	return params, nil
}

func parseDirectParamArray(raw json.RawMessage) ([]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || !bytes.HasPrefix(trimmed, []byte("[")) {
		return nil, fmt.Errorf("direct params must be an array")
	}
	var params []json.RawMessage
	if err := json.Unmarshal(trimmed, &params); err != nil {
		return nil, fmt.Errorf("direct params must be an array")
	}
	return params, nil
}
