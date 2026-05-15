package builder

import (
	"fmt"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type routedApprovalRequest struct {
	routePositionKey string
	request          ApprovalRequest
}

func buildDexExchangeApprovalRequests(
	context resolved.EncodingContext,
	priceRoute PriceRoute,
	routePlan resolved.RoutePlan,
	resolvedLegs []resolved.ResolvedLeg,
) ([]routedApprovalRequest, error) {
	legByKey := make(map[string]resolved.ResolvedLeg, len(resolvedLegs))
	for _, leg := range resolvedLegs {
		legByKey[resolved.ResolvedLegRoutePositionKey(leg)] = leg
	}

	routePositions := resolved.WalkRoutePlan(routePlan)
	requests := make([]routedApprovalRequest, 0)
	for _, routePosition := range routePositions {
		key := resolved.RoutePlanExchangeKey(routePosition)
		leg, ok := legByKey[key]
		if !ok {
			return nil, fmt.Errorf("missing resolved leg for route position %s", key)
		}
		swap := priceRoute.BestRoute[routePosition.RouteIndex].Swaps[routePosition.SwapIndex]
		approval := getApprovalTokenAndTarget(swap, leg.ExchangeParam, context)
		if approval == nil {
			continue
		}
		requests = append(requests, routedApprovalRequest{
			routePositionKey: key,
			request: ApprovalRequest{
				Token:   approval.token,
				Target:  approval.target,
				Permit2: leg.ExchangeParam.Permit2Approval != nil && *leg.ExchangeParam.Permit2Approval,
			},
		})
	}

	return requests, nil
}

type approvalTokenAndTarget struct {
	token  resolved.Address
	target resolved.Address
}

func getApprovalTokenAndTarget(
	swap PriceRouteSwap,
	exchangeParam resolved.DexExchangeBuildParam,
	context resolved.EncodingContext,
) *approvalTokenAndTarget {
	if exchangeParam.SkipApproval != nil && *exchangeParam.SkipApproval {
		return nil
	}

	target := exchangeParam.TargetExchange
	if exchangeParam.Spender != nil {
		target = *exchangeParam.Spender
	}

	if exchangeParam.NeedUnwrapNative != nil &&
		*exchangeParam.NeedUnwrapNative &&
		isWrappedNativeAddress(swap.SrcToken, context) {
		return nil
	}

	if !isNativeAddress(swap.SrcToken) && exchangeParam.TransferSrcTokenBeforeSwap == nil {
		return &approvalTokenAndTarget{
			token:  normalizeAddress(swap.SrcToken),
			target: normalizeAddress(target),
		}
	}

	if exchangeParam.NeedWrapNative.Value && isNativeAddress(swap.SrcToken) {
		token := context.WrappedNativeTokenAddress
		if exchangeParam.WethAddress != nil {
			token = *exchangeParam.WethAddress
		}
		return &approvalTokenAndTarget{
			token:  normalizeAddress(token),
			target: normalizeAddress(target),
		}
	}

	return nil
}

func applyDexExchangeApprovalDecisions(
	resolvedLegs []resolved.ResolvedLeg,
	approvalRequests []routedApprovalRequest,
	approvalDecisions []bool,
) ([]resolved.ResolvedLeg, error) {
	if len(approvalDecisions) != len(approvalRequests) {
		return nil, fmt.Errorf("approval decision length must match approval request count")
	}

	legByKey := make(map[string]resolved.ResolvedLeg, len(resolvedLegs))
	for _, leg := range resolvedLegs {
		legByKey[resolved.ResolvedLegRoutePositionKey(leg)] = leg
	}

	for index, alreadyApproved := range approvalDecisions {
		if alreadyApproved {
			continue
		}
		request := approvalRequests[index]
		leg, ok := legByKey[request.routePositionKey]
		if !ok {
			return nil, fmt.Errorf("missing resolved leg for route position %s", request.routePositionKey)
		}
		leg.ExchangeParam.ApproveData = &resolved.ApproveData{
			Token:  normalizeAddress(request.request.Token),
			Target: normalizeAddress(request.request.Target),
		}
		legByKey[request.routePositionKey] = leg
	}

	out := make([]resolved.ResolvedLeg, len(resolvedLegs))
	for index, leg := range resolvedLegs {
		key := resolved.ResolvedLegRoutePositionKey(leg)
		updated, ok := legByKey[key]
		if !ok {
			return nil, fmt.Errorf("missing resolved leg for route position %s", key)
		}
		out[index] = updated
	}

	return out, nil
}
