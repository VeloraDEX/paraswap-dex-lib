package builder

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildRequestJSONShape(t *testing.T) {
	isCapSurplus := true
	quotedAmount := resolved.DecimalString("990")
	permit := resolved.HexBytes("0x")
	request := BuildRequest{
		PriceRoute: PriceRoute{
			Network:        1,
			BlockNumber:    123,
			ContractMethod: resolved.ContractMethodSwapExactAmountIn,
			Side:           resolved.SideSell,
			SrcToken:       "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			DestToken:      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			SrcAmount:      "1000",
			DestAmount:     "990",
			BestRoute: []PriceRouteRoute{
				{
					Percent: 100,
					Swaps: []PriceRouteSwap{
						{
							SrcToken:   "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							DestToken:  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							SrcAmount:  ptr(resolved.DecimalString("1000")),
							DestAmount: ptr(resolved.DecimalString("990")),
							SwapExchanges: []PriceRouteSwapExchange{
								{
									Exchange:   "ExampleDex",
									Percent:    100,
									SrcAmount:  "1000",
									DestAmount: "990",
									Data:       json.RawMessage(`{"pool":"0xcccccccccccccccccccccccccccccccccccccccc"}`),
								},
							},
						},
					},
				},
			},
		},
		MinMaxAmount:      "990",
		QuotedAmount:      &quotedAmount,
		UserAddress:       "0x1111111111111111111111111111111111111111",
		PartnerAddress:    resolved.NullAddress,
		PartnerFeePercent: "0",
		IsCapSurplus:      &isCapSurplus,
		Permit:            &permit,
		Deadline:          "0",
		UUID:              "11111111-1111-1111-1111-111111111111",
	}

	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}

	var decoded BuildRequest
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}

	if decoded.PriceRoute.BestRoute[0].Swaps[0].SwapExchanges[0].Exchange != "ExampleDex" {
		t.Fatalf("unexpected exchange %s", decoded.PriceRoute.BestRoute[0].Swaps[0].SwapExchanges[0].Exchange)
	}
	if decoded.QuotedAmount == nil || *decoded.QuotedAmount != quotedAmount {
		t.Fatalf("quoted amount was not preserved: %#v", decoded.QuotedAmount)
	}
	if decoded.Permit == nil || *decoded.Permit != permit {
		t.Fatalf("permit was not preserved: %#v", decoded.Permit)
	}
	if decoded.IsCapSurplus == nil || *decoded.IsCapSurplus != isCapSurplus {
		t.Fatalf("isCapSurplus was not preserved: %#v", decoded.IsCapSurplus)
	}
}

func TestInterfaceImplementationsCompile(t *testing.T) {
	var _ DexRegistry = fakeRegistry{}
	var _ DexEncoder = fakeEncoder{}
	var _ ApprovalChecker = fakeApprovalChecker{}
	var _ WethCallDataProvider = fakeWethProvider{}
}

func ptr[T any](value T) *T {
	return &value
}

type fakeRegistry struct{}

func (fakeRegistry) GetDexEncoder(context.Context, int, string) (DexEncoder, error) {
	return fakeEncoder{}, nil
}

type fakeEncoder struct{}

func (fakeEncoder) NeedWrapNative(context.Context, NeedWrapNativeInput) (bool, error) {
	return false, nil
}

func (fakeEncoder) GetDexParam(context.Context, DexParamInput) (DexExchangeParam, error) {
	return DexExchangeParam{}, nil
}

type fakeApprovalChecker struct{}

func (fakeApprovalChecker) Check(context.Context, resolved.Address, []ApprovalRequest) ([]bool, error) {
	return nil, nil
}

type fakeWethProvider struct{}

func (fakeWethProvider) GetDepositWithdrawCallData(context.Context, WethCallDataInput) (*resolved.WethPlan, error) {
	return nil, nil
}
