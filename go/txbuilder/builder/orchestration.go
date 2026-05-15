package builder

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type genericDexCallParams struct {
	srcToken     resolved.Address
	destToken    resolved.Address
	srcAmount    resolved.DecimalString
	destAmount   resolved.DecimalString
	recipient    resolved.Address
	wethDeposit  *big.Int
	wethWithdraw *big.Int
}

type resolvedLegWithWeth struct {
	leg          resolved.ResolvedLeg
	wethDeposit  *big.Int
	wethWithdraw *big.Int
}

func resolveQuotedAmount(priceRoute PriceRoute, quotedAmount *resolved.DecimalString) resolved.DecimalString {
	if quotedAmount != nil && *quotedAmount != "" {
		return *quotedAmount
	}
	if priceRoute.Side == resolved.SideSell {
		return priceRoute.DestAmount
	}
	return priceRoute.SrcAmount
}

func resolveBeneficiary(userAddress resolved.Address, beneficiary *resolved.Address) resolved.Address {
	if beneficiary != nil &&
		*beneficiary != resolved.NullAddress &&
		normalizeAddress(*beneficiary) != normalizeAddress(userAddress) {
		return normalizeAddress(*beneficiary)
	}
	return resolved.NullAddress
}

func resolvePermit(permit *resolved.HexBytes) resolved.HexBytes {
	if permit == nil || *permit == "" {
		return "0x"
	}
	return normalizeHexBytes(*permit)
}

func resolveIsCapSurplus(value *bool) bool {
	if value == nil {
		return true
	}
	return *value
}

func resolveGas(req BuildRequest) *resolved.GasInput {
	gas := &resolved.GasInput{}
	hasGas := false
	if req.GasPrice != nil && *req.GasPrice != "" {
		gas.GasPrice = *req.GasPrice
		hasGas = true
	}
	if req.MaxFeePerGas != nil && *req.MaxFeePerGas != "" {
		gas.MaxFeePerGas = *req.MaxFeePerGas
		hasGas = true
	}
	if req.MaxPriorityFeePerGas != nil && *req.MaxPriorityFeePerGas != "" {
		gas.MaxPriorityFeePerGas = *req.MaxPriorityFeePerGas
		hasGas = true
	}
	if !hasGas {
		return nil
	}
	return gas
}

func buildGenericDexCallParams(
	priceRoute PriceRoute,
	routeIndex int,
	swap PriceRouteSwap,
	swapIndex int,
	swapExchange PriceRouteSwapExchange,
	minMaxAmount resolved.DecimalString,
	dexNeedWrapNative bool,
	executionContractAddress resolved.Address,
	wrappedNativeTokenAddress resolved.Address,
	augustusV6Address resolved.Address,
) (genericDexCallParams, error) {
	isMegaSwap := len(priceRoute.BestRoute) > 1
	isMultiSwap := !isMegaSwap && len(priceRoute.BestRoute) > 0 && len(priceRoute.BestRoute[0].Swaps) > 1
	isLastSwap := swapIndex == len(priceRoute.BestRoute[routeIndex].Swaps)-1

	srcToken := swap.SrcToken
	destToken := swap.DestToken
	wethDeposit := big.NewInt(0)
	wethWithdraw := big.NewInt(0)

	srcAmount := swapExchange.SrcAmount
	if swapIndex == 0 && priceRoute.Side == resolved.SideBuy {
		adjusted, err := mulDivDecimal(swapExchange.SrcAmount, minMaxAmount, priceRoute.SrcAmount, "buy srcAmount")
		if err != nil {
			return genericDexCallParams{}, err
		}
		srcAmount = adjusted
	}

	destAmount := resolved.DecimalString("1")
	if priceRoute.Side == resolved.SideBuy {
		destAmount = swapExchange.DestAmount
	}

	if isNativeAddress(swap.SrcToken) && dexNeedWrapNative {
		srcToken = wrappedNativeTokenAddress
		parsed, err := parseDecimal(srcAmount, "weth deposit amount")
		if err != nil {
			return genericDexCallParams{}, err
		}
		wethDeposit = parsed
	}

	forceUnwrap := isNativeAddress(swap.DestToken) &&
		(isMultiSwap || isMegaSwap) &&
		!dexNeedWrapNative &&
		!isLastSwap
	if (isNativeAddress(swap.DestToken) && dexNeedWrapNative) || forceUnwrap {
		// The force-unwrap branch keeps the leg dest token native because the DEX
		// already returns native ETH; it only accrues the downstream withdraw amount.
		if !forceUnwrap {
			destToken = wrappedNativeTokenAddress
		}
		parsed, err := parseDecimal(swapExchange.DestAmount, "weth withdraw amount")
		if err != nil {
			return genericDexCallParams{}, err
		}
		wethWithdraw = parsed
	}

	needToWithdrawAfterSwap := normalizeAddress(destToken) == normalizeAddress(wrappedNativeTokenAddress) &&
		wethWithdraw.Sign() > 0
	recipient := augustusV6Address
	if needToWithdrawAfterSwap || !isLastSwap || priceRoute.Side == resolved.SideBuy {
		recipient = executionContractAddress
	}

	return genericDexCallParams{
		srcToken:     normalizeAddress(srcToken),
		destToken:    normalizeAddress(destToken),
		srcAmount:    srcAmount,
		destAmount:   destAmount,
		recipient:    normalizeAddress(recipient),
		wethDeposit:  wethDeposit,
		wethWithdraw: wethWithdraw,
	}, nil
}

func buildNeedWrapNativeInput(
	priceRoute PriceRoute,
	routeIndex int,
	swap PriceRouteSwap,
	swapIndex int,
	swapExchange PriceRouteSwapExchange,
	swapExchangeIndex int,
) (NeedWrapNativeInput, error) {
	srcAmount, err := getSwapAmount(swap, "srcAmount")
	if err != nil {
		return NeedWrapNativeInput{}, err
	}
	destAmount, err := getSwapAmount(swap, "destAmount")
	if err != nil {
		return NeedWrapNativeInput{}, err
	}

	return NeedWrapNativeInput{
		Route: NeedWrapNativeRouteContext{
			Network:      priceRoute.Network,
			Side:         priceRoute.Side,
			RouteIndex:   routeIndex,
			RoutePercent: priceRoute.BestRoute[routeIndex].Percent,
			BlockNumber:  priceRoute.BlockNumber,
			SrcToken:     normalizeAddress(priceRoute.SrcToken),
			DestToken:    normalizeAddress(priceRoute.DestToken),
			SrcAmount:    priceRoute.SrcAmount,
			DestAmount:   priceRoute.DestAmount,
		},
		Swap: NeedWrapNativeSwapContext{
			SwapIndex:  swapIndex,
			SrcToken:   normalizeAddress(swap.SrcToken),
			DestToken:  normalizeAddress(swap.DestToken),
			SrcAmount:  srcAmount,
			DestAmount: destAmount,
		},
		SwapExchange: NeedWrapNativeSwapExchangeContext{
			SwapExchangeIndex: swapExchangeIndex,
			Exchange:          swapExchange.Exchange,
			Percent:           swapExchange.Percent,
			SrcAmount:         swapExchange.SrcAmount,
			DestAmount:        swapExchange.DestAmount,
			Data:              swapExchange.Data,
		},
	}, nil
}

func buildResolvedWethPlan(
	ctxInput wethPlanContext,
	legsWithWeth []resolvedLegWithWeth,
) ([]resolved.ResolvedLeg, *resolved.WethPlan, error) {
	resolvedLegs := make([]resolved.ResolvedLeg, len(legsWithWeth))
	srcAmountWethToDeposit := big.NewInt(0)
	destAmountWethToWithdraw := big.NewInt(0)

	for index, legWithWeth := range legsWithWeth {
		resolvedLegs[index] = legWithWeth.leg
		srcAmountWethToDeposit.Add(srcAmountWethToDeposit, legWithWeth.wethDeposit)
		destAmountWethToWithdraw.Add(destAmountWethToWithdraw, legWithWeth.wethWithdraw)
	}

	if srcAmountWethToDeposit.Sign() == 0 && destAmountWethToWithdraw.Sign() == 0 {
		return resolvedLegs, nil, nil
	}
	if srcAmountWethToDeposit.Cmp(destAmountWethToWithdraw) == 0 &&
		!hasAnyRouteWithEthAndDifferentNeedWrapNative(ctxInput.routePlan, resolvedLegs, ctxInput.wrappedNativeTokenAddress) {
		return resolvedLegs, nil, nil
	}

	provider := ctxInput.provider
	if provider == nil {
		provider = defaultWethProvider{wrappedNativeTokenAddress: ctxInput.wrappedNativeTokenAddress}
	}
	wethPlan, err := provider.GetDepositWithdrawCallData(ctxInput.ctx, WethCallDataInput{
		SrcAmountWeth:  resolved.DecimalString(srcAmountWethToDeposit.String()),
		DestAmountWeth: resolved.DecimalString(destAmountWethToWithdraw.String()),
		Side:           ctxInput.side,
	})
	if err != nil {
		return nil, nil, err
	}
	return resolvedLegs, normalizeWethPlan(wethPlan), nil
}

type wethPlanContext struct {
	ctx                       context.Context
	routePlan                 resolved.RoutePlan
	side                      resolved.Side
	wrappedNativeTokenAddress resolved.Address
	provider                  WethCallDataProvider
}

func hasAnyRouteWithEthAndDifferentNeedWrapNative(
	routePlan resolved.RoutePlan,
	resolvedLegs []resolved.ResolvedLeg,
	wrappedNativeTokenAddress resolved.Address,
) bool {
	legByKey := make(map[string]resolved.ResolvedLeg, len(resolvedLegs))
	for _, leg := range resolvedLegs {
		legByKey[resolved.ResolvedLegRoutePositionKey(leg)] = leg
	}

	weth := normalizeAddress(wrappedNativeTokenAddress)
	for routeIndex, route := range routePlan.Routes {
		needWrapValues := make([]bool, 0)
		for swapIndex, swap := range route.Swaps {
			for swapExchangeIndex := range swap.SwapExchanges {
				if !touchesNativeOrWrapped(swap, weth) {
					continue
				}
				key := resolved.RoutePositionKey(routeIndex, swapIndex, swapExchangeIndex)
				leg, ok := legByKey[key]
				if !ok {
					continue
				}
				needWrapValues = append(needWrapValues, leg.ExchangeParam.NeedWrapNative.Value)
			}
		}
		if hasMixedBools(needWrapValues) {
			return true
		}
	}

	return false
}

func touchesNativeOrWrapped(swap resolved.RoutePlanSwap, wrapped resolved.Address) bool {
	return normalizeAddress(swap.SrcToken) == resolved.NativeTokenAddress ||
		normalizeAddress(swap.DestToken) == resolved.NativeTokenAddress ||
		normalizeAddress(swap.SrcToken) == wrapped ||
		normalizeAddress(swap.DestToken) == wrapped
}

func hasMixedBools(values []bool) bool {
	if len(values) == 0 {
		return false
	}
	first := values[0]
	for _, value := range values[1:] {
		if value != first {
			return true
		}
	}
	return false
}

func normalizeDexExchangeParam(param DexExchangeParam) DexExchangeParam {
	param.WethAddress = normalizeAddressPtr(param.WethAddress)
	param.ExchangeData = normalizeHexBytes(param.ExchangeData)
	param.TargetExchange = normalizeAddress(param.TargetExchange)
	param.TransferSrcTokenBeforeSwap = normalizeAddressPtr(param.TransferSrcTokenBeforeSwap)
	param.Spender = normalizeAddressPtr(param.Spender)
	return param
}

func convertDexExchangeParam(param DexExchangeParam) resolved.DexExchangeBuildParam {
	param = normalizeDexExchangeParam(param)
	return resolved.DexExchangeBuildParam{
		NeedWrapNative:                        resolved.RawBool{Value: param.NeedWrapNative, Valid: true, Present: true},
		NeedUnwrapNative:                      param.NeedUnwrapNative,
		SkipApproval:                          param.SkipApproval,
		WethAddress:                           param.WethAddress,
		ExchangeData:                          param.ExchangeData,
		TargetExchange:                        param.TargetExchange,
		DexFuncHasRecipient:                   param.DexFuncHasRecipient,
		SpecialDexFlag:                        param.SpecialDexFlag,
		TransferSrcTokenBeforeSwap:            param.TransferSrcTokenBeforeSwap,
		Spender:                               param.Spender,
		SendEthButSupportsInsertFromAmount:    param.SendEthButSupportsInsertFromAmount,
		SpecialDexSupportsInsertFromAmount:    param.SpecialDexSupportsInsertFromAmount,
		SwappedAmountNotPresentInExchangeData: param.SwappedAmountNotPresentInExchangeData,
		ReturnAmountPos:                       param.ReturnAmountPos,
		InsertFromAmountPos:                   param.InsertFromAmountPos,
		AmountsPacked128:                      param.AmountsPacked128,
		Permit2Approval:                       param.Permit2Approval,
	}
}

func normalizeWethPlan(wethPlan *resolved.WethPlan) *resolved.WethPlan {
	if wethPlan == nil {
		return nil
	}
	normalized := *wethPlan
	if normalized.Deposit != nil {
		deposit := *normalized.Deposit
		deposit.Callee = normalizeAddress(deposit.Callee)
		deposit.Calldata = normalizeHexBytes(deposit.Calldata)
		normalized.Deposit = &deposit
	}
	if normalized.Withdraw != nil {
		withdraw := *normalized.Withdraw
		withdraw.Callee = normalizeAddress(withdraw.Callee)
		withdraw.Calldata = normalizeHexBytes(withdraw.Calldata)
		normalized.Withdraw = &withdraw
	}
	return &normalized
}

func marshalRaw(value any) (json.RawMessage, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(raw), nil
}

func marshalResolvedLegs(legs []resolved.ResolvedLeg) ([]json.RawMessage, error) {
	raw := make([]json.RawMessage, len(legs))
	for index, leg := range legs {
		encoded, err := marshalRaw(leg)
		if err != nil {
			return nil, fmt.Errorf("resolvedLegs[%d]: %w", index, err)
		}
		raw[index] = encoded
	}
	return raw, nil
}

func parseDecimal(value resolved.DecimalString, field string) (*big.Int, error) {
	parsed, ok := new(big.Int).SetString(string(value), 10)
	if !ok || parsed.Sign() < 0 {
		return nil, fmt.Errorf("%s must be a non-negative decimal integer: %s", field, value)
	}
	return parsed, nil
}

func mulDivDecimal(
	a resolved.DecimalString,
	b resolved.DecimalString,
	c resolved.DecimalString,
	field string,
) (resolved.DecimalString, error) {
	parsedA, err := parseDecimal(a, field)
	if err != nil {
		return "", err
	}
	parsedB, err := parseDecimal(b, field)
	if err != nil {
		return "", err
	}
	parsedC, err := parseDecimal(c, field)
	if err != nil {
		return "", err
	}
	if parsedC.Sign() == 0 {
		return "", fmt.Errorf("%s divisor must be non-zero", field)
	}

	out := new(big.Int).Mul(parsedA, parsedB)
	out.Div(out, parsedC)
	return resolved.DecimalString(out.String()), nil
}
