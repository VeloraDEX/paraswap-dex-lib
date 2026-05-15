package resolved

import "fmt"

func RoutePositionKey(routeIndex, swapIndex, swapExchangeIndex int) string {
	return fmt.Sprintf("%d:%d:%d", routeIndex, swapIndex, swapExchangeIndex)
}

func ResolvedLegRoutePositionKey(resolvedLeg ResolvedLeg) string {
	return RoutePositionKey(
		resolvedLeg.RouteIndex,
		resolvedLeg.SwapIndex,
		resolvedLeg.SwapExchangeIndex,
	)
}

func RoutePlanExchangeKey(exchange RoutePlanExchange) string {
	return RoutePositionKey(
		exchange.RouteIndex,
		exchange.SwapIndex,
		exchange.SwapExchangeIndex,
	)
}

func WalkRoutePlan(routePlan RoutePlan) []RoutePlanExchange {
	var exchanges []RoutePlanExchange
	for routeIndex, route := range routePlan.Routes {
		for swapIndex, swap := range route.Swaps {
			for swapExchangeIndex, swapExchange := range swap.SwapExchanges {
				exchanges = append(exchanges, RoutePlanExchange{
					RouteIndex:        routeIndex,
					SwapIndex:         swapIndex,
					SwapExchangeIndex: swapExchangeIndex,
					Route:             route,
					Swap:              swap,
					SwapExchange:      swapExchange,
				})
			}
		}
	}
	return exchanges
}

func GetRoutePlanLegCount(routePlan RoutePlan) int {
	count := 0
	for _, route := range routePlan.Routes {
		for _, swap := range route.Swaps {
			count += len(swap.SwapExchanges)
		}
	}
	return count
}
