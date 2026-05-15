package builder

import (
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func normalizeAddress(address resolved.Address) resolved.Address {
	return resolved.Address(strings.ToLower(string(address)))
}

func normalizeHexBytes(value resolved.HexBytes) resolved.HexBytes {
	return resolved.HexBytes(strings.ToLower(string(value)))
}

func normalizeAddressPtr(address *resolved.Address) *resolved.Address {
	if address == nil {
		return nil
	}
	normalized := normalizeAddress(*address)
	return &normalized
}

func normalizeBuildRequest(req BuildRequest) BuildRequest {
	req.PriceRoute.SrcToken = normalizeAddress(req.PriceRoute.SrcToken)
	req.PriceRoute.DestToken = normalizeAddress(req.PriceRoute.DestToken)
	for routeIndex := range req.PriceRoute.BestRoute {
		for swapIndex := range req.PriceRoute.BestRoute[routeIndex].Swaps {
			swap := &req.PriceRoute.BestRoute[routeIndex].Swaps[swapIndex]
			swap.SrcToken = normalizeAddress(swap.SrcToken)
			swap.DestToken = normalizeAddress(swap.DestToken)
		}
	}

	req.UserAddress = normalizeAddress(req.UserAddress)
	req.ReferrerAddress = normalizeAddressPtr(req.ReferrerAddress)
	req.PartnerAddress = normalizeAddress(req.PartnerAddress)
	req.Beneficiary = normalizeAddressPtr(req.Beneficiary)
	if req.Permit != nil {
		permit := normalizeHexBytes(*req.Permit)
		req.Permit = &permit
	}

	return req
}

func normalizeEncodingContext(context resolved.EncodingContext) resolved.EncodingContext {
	context.AugustusV6Address = normalizeAddress(context.AugustusV6Address)
	context.WrappedNativeTokenAddress = normalizeAddress(context.WrappedNativeTokenAddress)
	if context.ExecutorsAddresses != nil {
		normalized := make(map[resolved.ExecutorType]resolved.Address, len(context.ExecutorsAddresses))
		for executorType, address := range context.ExecutorsAddresses {
			normalized[executorType] = normalizeAddress(address)
		}
		context.ExecutorsAddresses = normalized
	}
	return context
}
