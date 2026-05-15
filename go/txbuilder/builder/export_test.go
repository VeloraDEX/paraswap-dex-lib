package builder

import (
	"context"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func BuildGenericInputForTest(ctx context.Context, req BuildRequest, deps Deps) (resolved.BuildInput, error) {
	return buildGenericInput(ctx, req, deps)
}

func DefaultWethProviderForTest(wrappedNativeTokenAddress resolved.Address) WethCallDataProvider {
	return defaultWethProvider{wrappedNativeTokenAddress: wrappedNativeTokenAddress}
}

func HasAnyRouteWithEthAndDifferentNeedWrapNativeForTest(
	routePlan resolved.RoutePlan,
	resolvedLegs []resolved.ResolvedLeg,
	wrappedNativeTokenAddress resolved.Address,
) bool {
	return hasAnyRouteWithEthAndDifferentNeedWrapNative(routePlan, resolvedLegs, wrappedNativeTokenAddress)
}
