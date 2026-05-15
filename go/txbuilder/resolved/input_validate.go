package resolved

import (
	"encoding/hex"
	"fmt"
	"strings"
)

func validateBuildInput(input BuildInput, deps BuildDeps) (validatedBuildInput, error) {
	if err := ValidateSupportedContractMethod(input.ContractMethod); err != nil {
		return validatedBuildInput{}, err
	}
	if err := ValidateExecutorDeps(input, deps); err != nil {
		return validatedBuildInput{}, err
	}

	fee, err := ParseFeeInput(input)
	if err != nil {
		return validatedBuildInput{}, err
	}
	if err := validateTopLevelFields(input, fee); err != nil {
		return validatedBuildInput{}, err
	}
	if err := ValidateEncodingContextDeps(input, deps); err != nil {
		return validatedBuildInput{}, err
	}

	routePlan, err := parseRoutePlan(input.RoutePlan)
	if err != nil {
		return validatedBuildInput{}, err
	}
	if err := validateRoutePlan(routePlan); err != nil {
		return validatedBuildInput{}, err
	}

	wethPlan, err := parseWethPlan(input.WethPlan)
	if err != nil {
		return validatedBuildInput{}, err
	}
	if err := validateWethPlan(wethPlan); err != nil {
		return validatedBuildInput{}, err
	}

	resolvedLegs, err := parseResolvedLegs(input.ResolvedLegs)
	if err != nil {
		return validatedBuildInput{}, err
	}
	if err := assertNoDuplicateResolvedLegs(resolvedLegs); err != nil {
		return validatedBuildInput{}, err
	}
	if err := assertRoutePlanLegCount(routePlan, len(resolvedLegs)); err != nil {
		return validatedBuildInput{}, err
	}

	routeExchanges := WalkRoutePlan(routePlan)
	routeKeys := make(map[string]struct{}, len(routeExchanges))
	for _, routeExchange := range routeExchanges {
		routeKeys[RoutePlanExchangeKey(routeExchange)] = struct{}{}
	}

	resolvedLegByKey := make(map[string]ResolvedLeg, len(resolvedLegs))
	for index, resolvedLeg := range resolvedLegs {
		key := ResolvedLegRoutePositionKey(resolvedLeg)
		if _, ok := routeKeys[key]; !ok {
			return validatedBuildInput{}, fmt.Errorf(
				"resolved leg route position %s is not in route plan",
				key,
			)
		}
		if err := validateResolvedLeg(resolvedLeg, index); err != nil {
			return validatedBuildInput{}, err
		}
		resolvedLegByKey[key] = resolvedLeg
	}

	for _, routeExchange := range routeExchanges {
		key := RoutePlanExchangeKey(routeExchange)
		if _, ok := resolvedLegByKey[key]; !ok {
			return validatedBuildInput{}, fmt.Errorf("missing resolved leg for route position %s", key)
		}
	}

	return validatedBuildInput{
		input:            input,
		routePlan:        routePlan,
		resolvedLegs:     resolvedLegs,
		wethPlan:         wethPlan,
		fee:              fee,
		resolvedLegByKey: resolvedLegByKey,
	}, nil
}

func validateTopLevelFields(input BuildInput, fee FeeInput) error {
	if err := assertLowercaseAddress(input.ExecutorAddress, "executorAddress"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(input.AugustusV6Address, "augustusV6Address"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(input.WrappedNativeTokenAddress, "wrappedNativeTokenAddress"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(input.SrcToken, "srcToken"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(input.DestToken, "destToken"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(input.UserAddress, "userAddress"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(input.Beneficiary, "beneficiary"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(fee.PartnerAddress, "fee.partnerAddress"); err != nil {
		return err
	}
	if fee.ReferrerAddress != nil {
		if err := assertLowercaseAddress(*fee.ReferrerAddress, "fee.referrerAddress"); err != nil {
			return err
		}
	}
	if err := assertDecimalAmountString(input.SrcAmount, "srcAmount"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(input.DestAmount, "destAmount"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(input.MinMaxAmount, "minMaxAmount"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(input.QuotedAmount, "quotedAmount"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(fee.PartnerFeePercent, "fee.partnerFeePercent"); err != nil {
		return err
	}
	if err := assertHexBytes(input.Permit, "permit"); err != nil {
		return err
	}
	if input.Gas != nil {
		if input.Gas.GasPrice != "" {
			if err := assertDecimalAmountString(input.Gas.GasPrice, "gas.gasPrice"); err != nil {
				return err
			}
		}
		if input.Gas.MaxFeePerGas != "" {
			if err := assertDecimalAmountString(input.Gas.MaxFeePerGas, "gas.maxFeePerGas"); err != nil {
				return err
			}
		}
		if input.Gas.MaxPriorityFeePerGas != "" {
			if err := assertDecimalAmountString(input.Gas.MaxPriorityFeePerGas, "gas.maxPriorityFeePerGas"); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateRoutePlan(routePlan RoutePlan) error {
	for routeIndex, route := range routePlan.Routes {
		for swapIndex, swap := range route.Swaps {
			swapPrefix := fmt.Sprintf("routePlan.routes[%d].swaps[%d]", routeIndex, swapIndex)
			if err := assertLowercaseAddress(swap.SrcToken, swapPrefix+".srcToken"); err != nil {
				return err
			}
			if err := assertLowercaseAddress(swap.DestToken, swapPrefix+".destToken"); err != nil {
				return err
			}
			if err := assertDecimalAmountString(swap.SrcAmount, swapPrefix+".srcAmount"); err != nil {
				return err
			}
			if err := assertDecimalAmountString(swap.DestAmount, swapPrefix+".destAmount"); err != nil {
				return err
			}
			for swapExchangeIndex, swapExchange := range swap.SwapExchanges {
				exchangePrefix := fmt.Sprintf("%s.swapExchanges[%d]", swapPrefix, swapExchangeIndex)
				if err := assertDecimalAmountString(swapExchange.SrcAmount, exchangePrefix+".srcAmount"); err != nil {
					return err
				}
				if err := assertDecimalAmountString(swapExchange.DestAmount, exchangePrefix+".destAmount"); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func validateWethPlan(wethPlan *WethPlan) error {
	if wethPlan == nil {
		return nil
	}
	if wethPlan.Deposit != nil {
		if err := validateWethSubPlan(*wethPlan.Deposit, "wethPlan.deposit"); err != nil {
			return err
		}
	}
	if wethPlan.Withdraw != nil {
		if err := validateWethSubPlan(*wethPlan.Withdraw, "wethPlan.withdraw"); err != nil {
			return err
		}
	}
	return nil
}

func validateWethSubPlan(plan WethSubPlan, prefix string) error {
	if err := assertLowercaseAddress(plan.Callee, prefix+".callee"); err != nil {
		return err
	}
	if err := assertHexBytes(plan.Calldata, prefix+".calldata"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(plan.Value, prefix+".value"); err != nil {
		return err
	}
	return nil
}

func validateResolvedLeg(resolvedLeg ResolvedLeg, index int) error {
	prefix := fmt.Sprintf("resolvedLegs[%d]", index)
	if err := assertLowercaseAddress(resolvedLeg.NormalizedSrcToken, prefix+".normalizedSrcToken"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(resolvedLeg.NormalizedDestToken, prefix+".normalizedDestToken"); err != nil {
		return err
	}
	if err := assertLowercaseAddress(resolvedLeg.Recipient, prefix+".recipient"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(resolvedLeg.NormalizedSrcAmount, prefix+".normalizedSrcAmount"); err != nil {
		return err
	}
	if err := assertDecimalAmountString(resolvedLeg.NormalizedDestAmount, prefix+".normalizedDestAmount"); err != nil {
		return err
	}
	return validateExchangeParam(resolvedLeg.ExchangeParam, prefix+".exchangeParam")
}

func validateExchangeParam(exchangeParam DexExchangeBuildParam, prefix string) error {
	if !exchangeParam.NeedWrapNative.Present || !exchangeParam.NeedWrapNative.Valid {
		return fmt.Errorf("%s.needWrapNative must be boolean", prefix)
	}
	if err := assertLowercaseAddress(exchangeParam.TargetExchange, prefix+".targetExchange"); err != nil {
		return err
	}
	if err := assertHexBytes(exchangeParam.ExchangeData, prefix+".exchangeData"); err != nil {
		return err
	}
	if exchangeParam.WethAddress != nil {
		if err := assertLowercaseAddress(*exchangeParam.WethAddress, prefix+".wethAddress"); err != nil {
			return err
		}
	}
	if exchangeParam.TransferSrcTokenBeforeSwap != nil {
		if err := assertLowercaseAddress(*exchangeParam.TransferSrcTokenBeforeSwap, prefix+".transferSrcTokenBeforeSwap"); err != nil {
			return err
		}
	}
	if exchangeParam.Spender != nil {
		if err := assertLowercaseAddress(*exchangeParam.Spender, prefix+".spender"); err != nil {
			return err
		}
	}
	if exchangeParam.ApproveData != nil {
		if err := assertLowercaseAddress(exchangeParam.ApproveData.Token, prefix+".approveData.token"); err != nil {
			return err
		}
		if err := assertLowercaseAddress(exchangeParam.ApproveData.Target, prefix+".approveData.target"); err != nil {
			return err
		}
	}
	return nil
}

func assertNoDuplicateResolvedLegs(resolvedLegs []ResolvedLeg) error {
	seen := make(map[string]struct{}, len(resolvedLegs))
	duplicateSeen := make(map[string]struct{})
	var duplicates []string
	for _, resolvedLeg := range resolvedLegs {
		key := ResolvedLegRoutePositionKey(resolvedLeg)
		if _, ok := seen[key]; ok {
			if _, alreadyDuplicate := duplicateSeen[key]; !alreadyDuplicate {
				duplicates = append(duplicates, key)
				duplicateSeen[key] = struct{}{}
			}
			continue
		}
		seen[key] = struct{}{}
	}
	if len(duplicates) > 0 {
		return fmt.Errorf("duplicate resolved leg route position(s): %s", strings.Join(duplicates, ", "))
	}
	return nil
}

func assertRoutePlanLegCount(routePlan RoutePlan, actualLegCount int) error {
	expectedLegCount := GetRoutePlanLegCount(routePlan)
	if actualLegCount != expectedLegCount {
		return fmt.Errorf(
			"route-plan leg count mismatch: expected %d, got %d",
			expectedLegCount,
			actualLegCount,
		)
	}
	return nil
}

func assertLowercaseAddress(value Address, fieldName string) error {
	raw := string(value)
	if len(raw) != 42 || !strings.HasPrefix(raw, "0x") {
		return fmt.Errorf("%s must be a lowercase 42-character hex address", fieldName)
	}
	for _, char := range raw[2:] {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return fmt.Errorf("%s must be a lowercase 42-character hex address", fieldName)
		}
	}
	return nil
}

func assertDecimalAmountString(value DecimalString, fieldName string) error {
	raw := string(value)
	if raw == "" {
		return fmt.Errorf("%s must be a decimal amount string", fieldName)
	}
	for _, char := range raw {
		if char < '0' || char > '9' {
			return fmt.Errorf("%s must be a decimal amount string", fieldName)
		}
	}
	return nil
}

func assertHexBytes(value HexBytes, fieldName string) error {
	raw := string(value)
	if !strings.HasPrefix(raw, "0x") || len(raw[2:])%2 != 0 {
		return fmt.Errorf("%s must be 0x-prefixed hex bytes", fieldName)
	}
	if _, err := hex.DecodeString(raw[2:]); err != nil {
		return fmt.Errorf("%s must be 0x-prefixed hex bytes", fieldName)
	}
	return nil
}
