package builder

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func BuildGeneric(ctx context.Context, req BuildRequest, deps Deps) (resolved.BuildOutput, error) {
	input, err := buildGenericInput(ctx, req, deps)
	if err != nil {
		return resolved.BuildOutput{}, err
	}

	return resolved.BuildTransactionFromResolved(input, resolved.BuildDeps{
		EncodingContext:                normalizeEncodingContext(deps.EncodingContext),
		AugustusV6ABI:                  deps.AugustusV6ABI,
		ExecutorBytecodeBuilderFactory: deps.ExecutorFactory,
	})
}

func buildGenericInput(ctx context.Context, req BuildRequest, deps Deps) (resolved.BuildInput, error) {
	if err := validateRequiredDeps(deps); err != nil {
		return resolved.BuildInput{}, err
	}

	req = normalizeBuildRequest(req)
	encodingContext := normalizeEncodingContext(deps.EncodingContext)

	if req.PriceRoute.Side != resolved.SideSell && req.PriceRoute.Side != resolved.SideBuy {
		return resolved.BuildInput{}, fmt.Errorf("invalid side: %s", req.PriceRoute.Side)
	}
	if err := resolved.ValidateSupportedContractMethod(req.PriceRoute.ContractMethod); err != nil {
		return resolved.BuildInput{}, err
	}

	routePlan, err := BuildRoutePlan(req.PriceRoute)
	if err != nil {
		return resolved.BuildInput{}, err
	}

	executorType, err := DetectExecutor(req.PriceRoute)
	if err != nil {
		return resolved.BuildInput{}, err
	}
	executorAddress, ok := encodingContext.ExecutorsAddresses[executorType]
	if !ok || executorAddress == "" {
		return resolved.BuildInput{}, fmt.Errorf("executor address is required for %s", executorType)
	}

	preInput := resolved.BuildInput{
		ExecutorType:              executorType,
		ExecutorAddress:           executorAddress,
		AugustusV6Address:         encodingContext.AugustusV6Address,
		WrappedNativeTokenAddress: encodingContext.WrappedNativeTokenAddress,
		Network:                   req.PriceRoute.Network,
		Side:                      req.PriceRoute.Side,
		ContractMethod:            req.PriceRoute.ContractMethod,
	}
	preDeps := resolved.BuildDeps{EncodingContext: encodingContext}
	if err := resolved.ValidateEncodingContextDeps(preInput, preDeps); err != nil {
		return resolved.BuildInput{}, err
	}
	if err := resolved.ValidateExecutorDeps(preInput, preDeps); err != nil {
		return resolved.BuildInput{}, err
	}
	if err := validateResolvedExecutorFences(preInput); err != nil {
		return resolved.BuildInput{}, err
	}

	legsWithWeth, err := buildResolvedLegs(ctx, req, deps, encodingContext, routePlan, executorAddress)
	if err != nil {
		return resolved.BuildInput{}, err
	}

	resolvedLegs, wethPlan, err := buildResolvedWethPlan(wethPlanContext{
		ctx:                       ctx,
		routePlan:                 routePlan,
		side:                      req.PriceRoute.Side,
		wrappedNativeTokenAddress: encodingContext.WrappedNativeTokenAddress,
		provider:                  deps.WethProvider,
	}, legsWithWeth)
	if err != nil {
		return resolved.BuildInput{}, err
	}

	resolvedLegs, err = addDexExchangeApproveParams(ctx, deps, encodingContext, executorAddress, req.PriceRoute, routePlan, resolvedLegs)
	if err != nil {
		return resolved.BuildInput{}, err
	}

	routePlanRaw, err := marshalRaw(routePlan)
	if err != nil {
		return resolved.BuildInput{}, err
	}
	resolvedLegsRaw, err := marshalResolvedLegs(resolvedLegs)
	if err != nil {
		return resolved.BuildInput{}, err
	}
	var wethPlanRaw *json.RawMessage
	if wethPlan != nil {
		raw, err := marshalRaw(wethPlan)
		if err != nil {
			return resolved.BuildInput{}, err
		}
		wethPlanRaw = &raw
	}
	feeRaw, err := marshalRaw(publicFeeInput{
		PartnerAddress:      req.PartnerAddress,
		PartnerFeePercent:   req.PartnerFeePercent,
		ReferrerAddress:     req.ReferrerAddress,
		TakeSurplus:         req.TakeSurplus,
		IsCapSurplus:        resolveIsCapSurplus(req.IsCapSurplus),
		IsSurplusToUser:     req.IsSurplusToUser,
		IsDirectFeeTransfer: req.IsDirectFeeTransfer,
	})
	if err != nil {
		return resolved.BuildInput{}, err
	}

	return resolved.BuildInput{
		RoutePlan:                 routePlanRaw,
		ResolvedLegs:              resolvedLegsRaw,
		WethPlan:                  wethPlanRaw,
		ExecutorType:              executorType,
		ExecutorAddress:           executorAddress,
		AugustusV6Address:         encodingContext.AugustusV6Address,
		WrappedNativeTokenAddress: encodingContext.WrappedNativeTokenAddress,
		Network:                   req.PriceRoute.Network,
		SrcToken:                  req.PriceRoute.SrcToken,
		DestToken:                 req.PriceRoute.DestToken,
		SrcAmount:                 req.PriceRoute.SrcAmount,
		DestAmount:                req.PriceRoute.DestAmount,
		MinMaxAmount:              req.MinMaxAmount,
		QuotedAmount:              resolveQuotedAmount(req.PriceRoute, req.QuotedAmount),
		Side:                      req.PriceRoute.Side,
		ContractMethod:            req.PriceRoute.ContractMethod,
		BlockNumber:               req.PriceRoute.BlockNumber,
		UserAddress:               req.UserAddress,
		Beneficiary:               resolveBeneficiary(req.UserAddress, req.Beneficiary),
		Permit:                    resolvePermit(req.Permit),
		UUID:                      req.UUID,
		Fee:                       feeRaw,
		Gas:                       resolveGas(req),
	}, nil
}

type publicFeeInput struct {
	PartnerAddress      resolved.Address       `json:"partnerAddress"`
	PartnerFeePercent   resolved.DecimalString `json:"partnerFeePercent"`
	ReferrerAddress     *resolved.Address      `json:"referrerAddress,omitempty"`
	TakeSurplus         bool                   `json:"takeSurplus"`
	IsCapSurplus        bool                   `json:"isCapSurplus"`
	IsSurplusToUser     bool                   `json:"isSurplusToUser"`
	IsDirectFeeTransfer bool                   `json:"isDirectFeeTransfer"`
}

func validateRequiredDeps(deps Deps) error {
	if deps.AugustusV6ABI == nil {
		return fmt.Errorf("augustus V6 ABI is required")
	}
	if deps.ExecutorFactory == nil {
		return fmt.Errorf("executor bytecode builder factory is required")
	}
	if deps.DexRegistry == nil {
		return fmt.Errorf("dex registry is required")
	}
	if deps.EncodingContext.Network == 0 {
		return fmt.Errorf("encoding context network is required")
	}
	if deps.EncodingContext.AugustusV6Address == "" {
		return fmt.Errorf("encoding context augustusV6Address is required")
	}
	if deps.EncodingContext.WrappedNativeTokenAddress == "" {
		return fmt.Errorf("encoding context wrappedNativeTokenAddress is required")
	}
	if deps.EncodingContext.ExecutorsAddresses == nil {
		return fmt.Errorf("encoding context executor addresses are required")
	}
	return nil
}

func validateResolvedExecutorFences(input resolved.BuildInput) error {
	if input.ExecutorType == resolved.Executor02 &&
		(input.Side == resolved.SideBuy ||
			input.ContractMethod == resolved.ContractMethodSwapExactAmountOut ||
			input.ContractMethod == resolved.ContractMethodSwapExactAmountOutPro) {
		return fmt.Errorf("Executor02 BUY routes are not implemented in Phase 2c")
	}
	if input.ExecutorType == resolved.Executor03 &&
		(input.Side != resolved.SideBuy ||
			(input.ContractMethod != resolved.ContractMethodSwapExactAmountOut &&
				input.ContractMethod != resolved.ContractMethodSwapExactAmountOutPro)) {
		return fmt.Errorf("Executor03 non-BUY routes are not implemented in Phase 2d")
	}
	return nil
}

func buildResolvedLegs(
	ctx context.Context,
	req BuildRequest,
	deps Deps,
	encodingContext resolved.EncodingContext,
	routePlan resolved.RoutePlan,
	executorAddress resolved.Address,
) ([]resolvedLegWithWeth, error) {
	routePositions := resolved.WalkRoutePlan(routePlan)
	legs := make([]resolvedLegWithWeth, 0, len(routePositions))

	for _, routePosition := range routePositions {
		routeIndex := routePosition.RouteIndex
		swapIndex := routePosition.SwapIndex
		swapExchangeIndex := routePosition.SwapExchangeIndex
		swap := req.PriceRoute.BestRoute[routeIndex].Swaps[swapIndex]
		swapExchange := swap.SwapExchanges[swapExchangeIndex]
		key := resolved.RoutePlanExchangeKey(routePosition)

		needWrapNativeInput, err := buildNeedWrapNativeInput(
			req.PriceRoute,
			routeIndex,
			swap,
			swapIndex,
			swapExchange,
			swapExchangeIndex,
		)
		if err != nil {
			return nil, err
		}

		dexEncoder, err := deps.DexRegistry.GetDexEncoder(ctx, req.PriceRoute.Network, swapExchange.Exchange)
		if err != nil {
			return nil, err
		}
		if dexEncoder == nil {
			return nil, fmt.Errorf("dex encoder is required for %s", swapExchange.Exchange)
		}

		dexNeedWrapNative, err := dexEncoder.NeedWrapNative(ctx, needWrapNativeInput)
		if err != nil {
			return nil, err
		}
		callParams, err := buildGenericDexCallParams(
			req.PriceRoute,
			routeIndex,
			swap,
			swapIndex,
			swapExchange,
			req.MinMaxAmount,
			dexNeedWrapNative,
			executorAddress,
			encodingContext.WrappedNativeTokenAddress,
			encodingContext.AugustusV6Address,
		)
		if err != nil {
			return nil, err
		}

		srcAmountForDex := callParams.srcAmount
		if req.PriceRoute.Side == resolved.SideBuy {
			srcAmountForDex = swapExchange.SrcAmount
		}
		dexParamInput := DexParamInput{
			NeedWrapNativeInput: needWrapNativeInput,
			DexKey:              swapExchange.Exchange,
			SrcToken:            callParams.srcToken,
			DestToken:           callParams.destToken,
			SrcAmount:           srcAmountForDex,
			DestAmount:          callParams.destAmount,
			Recipient:           callParams.recipient,
			ExecutorAddress:     executorAddress,
			Side:                req.PriceRoute.Side,
			Data:                swapExchange.Data,
		}
		dexParam, err := dexEncoder.GetDexParam(ctx, dexParamInput)
		if err != nil {
			return nil, err
		}
		if dexParam.NeedWrapNative != dexNeedWrapNative {
			return nil, fmt.Errorf(
				"needWrapNative mismatch for route position %s: expected %t, got %t",
				key,
				dexNeedWrapNative,
				dexParam.NeedWrapNative,
			)
		}

		legs = append(legs, resolvedLegWithWeth{
			leg: resolved.ResolvedLeg{
				RouteIndex:           routeIndex,
				SwapIndex:            swapIndex,
				SwapExchangeIndex:    swapExchangeIndex,
				ExchangeParam:        convertDexExchangeParam(dexParam),
				NormalizedSrcToken:   callParams.srcToken,
				NormalizedDestToken:  callParams.destToken,
				NormalizedSrcAmount:  callParams.srcAmount,
				NormalizedDestAmount: callParams.destAmount,
				Recipient:            callParams.recipient,
			},
			wethDeposit:  callParams.wethDeposit,
			wethWithdraw: callParams.wethWithdraw,
		})
	}

	return legs, nil
}

func addDexExchangeApproveParams(
	ctx context.Context,
	deps Deps,
	encodingContext resolved.EncodingContext,
	spender resolved.Address,
	priceRoute PriceRoute,
	routePlan resolved.RoutePlan,
	resolvedLegs []resolved.ResolvedLeg,
) ([]resolved.ResolvedLeg, error) {
	approvalRequests, err := buildDexExchangeApprovalRequests(
		encodingContext,
		priceRoute,
		routePlan,
		resolvedLegs,
	)
	if err != nil {
		return nil, err
	}

	approvalDecisions := make([]bool, len(approvalRequests))
	if deps.Options.SkipApprovalCheck {
		return applyDexExchangeApprovalDecisions(resolvedLegs, approvalRequests, approvalDecisions)
	}

	if len(approvalRequests) == 0 {
		return resolvedLegs, nil
	}
	if deps.ApprovalChecker == nil {
		return nil, fmt.Errorf("approval checker is required")
	}

	requests := make([]ApprovalRequest, len(approvalRequests))
	for index, request := range approvalRequests {
		requests[index] = request.request
		requests[index].RoutePositionKey = request.routePositionKey
	}
	approvalDecisions, err = deps.ApprovalChecker.Check(ctx, spender, requests)
	if err != nil {
		return nil, err
	}

	return applyDexExchangeApprovalDecisions(resolvedLegs, approvalRequests, approvalDecisions)
}
