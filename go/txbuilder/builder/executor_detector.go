package builder

import (
	"fmt"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

const (
	networkMainnet   = 1
	networkOptimism  = 10
	networkBSC       = 56
	networkGnosis    = 100
	networkUnichain  = 130
	networkPolygon   = 137
	networkSonic     = 146
	networkBase      = 8453
	networkAvalanche = 43114
)

var supportedWethNetworks = map[int]struct{}{
	networkMainnet:   {},
	networkAvalanche: {},
	networkBSC:       {},
	networkBase:      {},
	networkPolygon:   {},
	networkOptimism:  {},
	networkGnosis:    {},
	networkUnichain:  {},
	networkSonic:     {},
}

// Keep this list in lockstep with Object.keys(WethConfig) in the TypeScript
// builder. Arbitrum is intentionally absent, matching the TS single-wrap route
// predicate that cannot rely on the fallback deposit case there.
var supportedWethExchanges = map[string]struct{}{
	"Weth":   {},
	"Wbnb":   {},
	"Wmatic": {},
	"wS":     {},
	"Wavax":  {},
	"Wxdai":  {},
}

type routeExecutionType string

const (
	routeExecutionSingleStep                             routeExecutionType = "SINGLE_STEP"
	routeExecutionHorizontalSequence                     routeExecutionType = "HORIZONTAL_SEQUENCE"
	routeExecutionVerticalBranch                         routeExecutionType = "VERTICAL_BRANCH"
	routeExecutionVerticalBranchHorizontalSequence       routeExecutionType = "VERTICAL_BRANCH_HORIZONTAL_SEQUENCE"
	routeExecutionNestedVerticalBranchHorizontalSequence routeExecutionType = "NESTED_VERTICAL_BRANCH_HORIZONTAL_SEQUENCE"
)

func DetectExecutor(priceRoute PriceRoute) (resolved.ExecutorType, error) {
	if isSingleWrapRoute(priceRoute) {
		return resolved.ExecutorWETH, nil
	}

	routeType, err := getRouteExecutionType(priceRoute)
	if err != nil {
		return "", err
	}

	if priceRoute.Side == resolved.SideSell {
		switch routeType {
		case routeExecutionSingleStep, routeExecutionHorizontalSequence:
			return resolved.Executor01, nil
		case routeExecutionVerticalBranch,
			routeExecutionVerticalBranchHorizontalSequence,
			routeExecutionNestedVerticalBranchHorizontalSequence:
			return resolved.Executor02, nil
		}
	}

	if priceRoute.Side == resolved.SideBuy {
		switch routeType {
		case routeExecutionSingleStep, routeExecutionVerticalBranch:
			return resolved.Executor03, nil
		}
	}

	return "", fmt.Errorf("undefined is not implemented")
}

func getRouteExecutionType(priceRoute PriceRoute) (routeExecutionType, error) {
	if len(priceRoute.BestRoute) == 1 &&
		priceRoute.BestRoute[0].Percent == 100 &&
		len(priceRoute.BestRoute[0].Swaps) == 1 &&
		len(priceRoute.BestRoute[0].Swaps[0].SwapExchanges) > 1 {
		return routeExecutionVerticalBranch, nil
	}

	if len(priceRoute.BestRoute) == 1 &&
		priceRoute.BestRoute[0].Percent == 100 &&
		len(priceRoute.BestRoute[0].Swaps) == 1 {
		return routeExecutionSingleStep, nil
	}

	if len(priceRoute.BestRoute) == 1 &&
		priceRoute.BestRoute[0].Percent == 100 &&
		len(priceRoute.BestRoute[0].Swaps) > 1 {
		has100PercentOnEachPath := true
		for _, swap := range priceRoute.BestRoute[0].Swaps {
			for _, swapExchange := range swap.SwapExchanges {
				if swapExchange.Percent != 100 {
					has100PercentOnEachPath = false
				}
			}
		}
		if has100PercentOnEachPath {
			return routeExecutionHorizontalSequence, nil
		}
		return routeExecutionVerticalBranchHorizontalSequence, nil
	}

	if len(priceRoute.BestRoute) > 1 {
		return routeExecutionNestedVerticalBranchHorizontalSequence, nil
	}

	return "", fmt.Errorf("Route type is not supported yet")
}

func isSingleWrapRoute(priceRoute PriceRoute) bool {
	if _, ok := supportedWethNetworks[priceRoute.Network]; !ok {
		return false
	}
	if len(priceRoute.BestRoute) != 1 ||
		len(priceRoute.BestRoute[0].Swaps) != 1 ||
		len(priceRoute.BestRoute[0].Swaps[0].SwapExchanges) != 1 {
		return false
	}
	if _, ok := supportedWethExchanges[priceRoute.BestRoute[0].Swaps[0].SwapExchanges[0].Exchange]; !ok {
		return false
	}
	return isNativeAddress(priceRoute.SrcToken)
}

func isNativeAddress(address resolved.Address) bool {
	return normalizeAddress(address) == resolved.NativeTokenAddress
}

func isWrappedNativeAddress(address resolved.Address, context resolved.EncodingContext) bool {
	return normalizeAddress(address) == normalizeAddress(context.WrappedNativeTokenAddress)
}
