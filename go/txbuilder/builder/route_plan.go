package builder

import (
	"fmt"
	"math/big"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type RoutePlanExchange struct {
	RouteIndex        int
	SwapIndex         int
	SwapExchangeIndex int
	Route             resolved.RoutePlanRoute
	Swap              resolved.RoutePlanSwap
	SwapExchange      resolved.RoutePlanSwapExchange
}

func BuildRoutePlan(priceRoute PriceRoute) (resolved.RoutePlan, error) {
	routes := make([]resolved.RoutePlanRoute, len(priceRoute.BestRoute))
	for routeIndex, route := range priceRoute.BestRoute {
		swaps := make([]resolved.RoutePlanSwap, len(route.Swaps))
		for swapIndex, swap := range route.Swaps {
			routePlanSwap, err := buildRoutePlanSwap(swap)
			if err != nil {
				return resolved.RoutePlan{}, fmt.Errorf("priceRoute.bestRoute[%d].swaps[%d]: %w", routeIndex, swapIndex, err)
			}
			swaps[swapIndex] = routePlanSwap
		}
		routes[routeIndex] = resolved.RoutePlanRoute{
			Percent: route.Percent,
			Swaps:   swaps,
		}
	}

	return resolved.RoutePlan{Routes: routes}, nil
}

func WalkRoutePlan(routePlan resolved.RoutePlan) []RoutePlanExchange {
	walked := resolved.WalkRoutePlan(routePlan)
	exchanges := make([]RoutePlanExchange, len(walked))
	for index, exchange := range walked {
		exchanges[index] = RoutePlanExchange(exchange)
	}
	return exchanges
}

func RoutePositionKey(routeIndex, swapIndex, swapExchangeIndex int) string {
	return resolved.RoutePositionKey(routeIndex, swapIndex, swapExchangeIndex)
}

func buildRoutePlanSwap(swap PriceRouteSwap) (resolved.RoutePlanSwap, error) {
	srcAmount, err := getSwapAmount(swap, "srcAmount")
	if err != nil {
		return resolved.RoutePlanSwap{}, err
	}
	destAmount, err := getSwapAmount(swap, "destAmount")
	if err != nil {
		return resolved.RoutePlanSwap{}, err
	}

	swapExchanges := make([]resolved.RoutePlanSwapExchange, len(swap.SwapExchanges))
	for index, swapExchange := range swap.SwapExchanges {
		swapExchanges[index] = resolved.RoutePlanSwapExchange{
			Exchange:   swapExchange.Exchange,
			Percent:    swapExchange.Percent,
			SrcAmount:  swapExchange.SrcAmount,
			DestAmount: swapExchange.DestAmount,
		}
	}

	return resolved.RoutePlanSwap{
		SrcToken:      normalizeAddress(swap.SrcToken),
		DestToken:     normalizeAddress(swap.DestToken),
		SrcAmount:     srcAmount,
		DestAmount:    destAmount,
		SwapExchanges: swapExchanges,
	}, nil
}

func getSwapAmount(swap PriceRouteSwap, field string) (resolved.DecimalString, error) {
	switch field {
	case "srcAmount":
		if swap.SrcAmount != nil {
			return *swap.SrcAmount, nil
		}
	case "destAmount":
		if swap.DestAmount != nil {
			return *swap.DestAmount, nil
		}
	default:
		return "", fmt.Errorf("unsupported amount field %s", field)
	}

	sum := big.NewInt(0)
	for _, swapExchange := range swap.SwapExchanges {
		value := swapExchange.SrcAmount
		if field == "destAmount" {
			value = swapExchange.DestAmount
		}
		parsed, ok := new(big.Int).SetString(string(value), 10)
		if !ok || parsed.Sign() < 0 {
			return "", fmt.Errorf("%s must be a non-negative decimal integer: %s", field, value)
		}
		sum.Add(sum, parsed)
	}

	return resolved.DecimalString(sum.String()), nil
}
