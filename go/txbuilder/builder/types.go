package builder

import (
	"context"
	"encoding/json"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

// BuildGeneric lands in Phase 2 with this public shape:
// func BuildGeneric(ctx context.Context, req BuildRequest, deps Deps) (resolved.BuildOutput, error)

type BuildRequest struct {
	PriceRoute           PriceRoute              `json:"priceRoute"`
	MinMaxAmount         resolved.DecimalString  `json:"minMaxAmount"`
	QuotedAmount         *resolved.DecimalString `json:"quotedAmount,omitempty"`
	UserAddress          resolved.Address        `json:"userAddress"`
	ReferrerAddress      *resolved.Address       `json:"referrerAddress,omitempty"`
	PartnerAddress       resolved.Address        `json:"partnerAddress"`
	PartnerFeePercent    resolved.DecimalString  `json:"partnerFeePercent"`
	TakeSurplus          bool                    `json:"takeSurplus"`
	IsCapSurplus         *bool                   `json:"isCapSurplus,omitempty"`
	IsSurplusToUser      bool                    `json:"isSurplusToUser"`
	IsDirectFeeTransfer  bool                    `json:"isDirectFeeTransfer"`
	GasPrice             *resolved.DecimalString `json:"gasPrice,omitempty"`
	MaxFeePerGas         *resolved.DecimalString `json:"maxFeePerGas,omitempty"`
	MaxPriorityFeePerGas *resolved.DecimalString `json:"maxPriorityFeePerGas,omitempty"`
	Permit               *resolved.HexBytes      `json:"permit,omitempty"`
	Deadline             resolved.DecimalString  `json:"deadline"`
	UUID                 string                  `json:"uuid"`
	Beneficiary          *resolved.Address       `json:"beneficiary,omitempty"`
}

type PriceRoute struct {
	Network        int                    `json:"network"`
	BlockNumber    int64                  `json:"blockNumber"`
	ContractMethod string                 `json:"contractMethod"`
	Side           resolved.Side          `json:"side"`
	SrcToken       resolved.Address       `json:"srcToken"`
	DestToken      resolved.Address       `json:"destToken"`
	SrcAmount      resolved.DecimalString `json:"srcAmount"`
	DestAmount     resolved.DecimalString `json:"destAmount"`
	BestRoute      []PriceRouteRoute      `json:"bestRoute"`
}

type PriceRouteRoute struct {
	Percent float64          `json:"percent"`
	Swaps   []PriceRouteSwap `json:"swaps"`
}

type PriceRouteSwap struct {
	SrcToken      resolved.Address         `json:"srcToken"`
	DestToken     resolved.Address         `json:"destToken"`
	SrcAmount     *resolved.DecimalString  `json:"srcAmount,omitempty"`
	DestAmount    *resolved.DecimalString  `json:"destAmount,omitempty"`
	SwapExchanges []PriceRouteSwapExchange `json:"swapExchanges"`
}

type PriceRouteSwapExchange struct {
	Exchange   string                 `json:"exchange"`
	Percent    float64                `json:"percent"`
	SrcAmount  resolved.DecimalString `json:"srcAmount"`
	DestAmount resolved.DecimalString `json:"destAmount"`
	Data       json.RawMessage        `json:"data,omitempty"`
}

type Deps struct {
	EncodingContext resolved.EncodingContext
	AugustusV6ABI   *ethabi.ABI
	ExecutorFactory resolved.ExecutorBytecodeBuilderFactory
	DexRegistry     DexRegistry
	ApprovalChecker ApprovalChecker
	WethProvider    WethCallDataProvider
	Options         Options
}

type Options struct {
	SkipApprovalCheck bool
}

type DexRegistry interface {
	GetDexEncoder(ctx context.Context, network int, dexKey string) (DexEncoder, error)
}

type DexEncoder interface {
	NeedWrapNative(ctx context.Context, input NeedWrapNativeInput) (bool, error)
	GetDexParam(ctx context.Context, input DexParamInput) (DexExchangeParam, error)
}

type ApprovalRequest struct {
	RoutePositionKey string           `json:"routePositionKey,omitempty"`
	Token            resolved.Address `json:"token"`
	Target           resolved.Address `json:"target"`
	Permit2          bool             `json:"permit2"`
}

type ApprovalChecker interface {
	Check(ctx context.Context, spender resolved.Address, requests []ApprovalRequest) ([]bool, error)
}

type WethCallDataInput struct {
	SrcAmountWeth  resolved.DecimalString `json:"srcAmountWeth"`
	DestAmountWeth resolved.DecimalString `json:"destAmountWeth"`
	Side           resolved.Side          `json:"side"`
}

type WethCallDataProvider interface {
	GetDepositWithdrawCallData(ctx context.Context, input WethCallDataInput) (*resolved.WethPlan, error)
}

type NeedWrapNativeInput struct {
	Route        NeedWrapNativeRouteContext        `json:"route"`
	Swap         NeedWrapNativeSwapContext         `json:"swap"`
	SwapExchange NeedWrapNativeSwapExchangeContext `json:"swapExchange"`
}

type NeedWrapNativeRouteContext struct {
	Network      int                    `json:"network"`
	Side         resolved.Side          `json:"side"`
	RouteIndex   int                    `json:"routeIndex"`
	RoutePercent float64                `json:"routePercent"`
	BlockNumber  int64                  `json:"blockNumber"`
	SrcToken     resolved.Address       `json:"srcToken"`
	DestToken    resolved.Address       `json:"destToken"`
	SrcAmount    resolved.DecimalString `json:"srcAmount"`
	DestAmount   resolved.DecimalString `json:"destAmount"`
}

type NeedWrapNativeSwapContext struct {
	SwapIndex  int                    `json:"swapIndex"`
	SrcToken   resolved.Address       `json:"srcToken"`
	DestToken  resolved.Address       `json:"destToken"`
	SrcAmount  resolved.DecimalString `json:"srcAmount"`
	DestAmount resolved.DecimalString `json:"destAmount"`
}

type NeedWrapNativeSwapExchangeContext struct {
	SwapExchangeIndex int                    `json:"swapExchangeIndex"`
	Exchange          string                 `json:"exchange"`
	Percent           float64                `json:"percent"`
	SrcAmount         resolved.DecimalString `json:"srcAmount"`
	DestAmount        resolved.DecimalString `json:"destAmount"`
	Data              json.RawMessage        `json:"data,omitempty"`
}

type DexParamInput struct {
	NeedWrapNativeInput
	DexKey          string                 `json:"dexKey"`
	SrcToken        resolved.Address       `json:"srcToken"`
	DestToken       resolved.Address       `json:"destToken"`
	SrcAmount       resolved.DecimalString `json:"srcAmount"`
	DestAmount      resolved.DecimalString `json:"destAmount"`
	Recipient       resolved.Address       `json:"recipient"`
	ExecutorAddress resolved.Address       `json:"executorAddress"`
	Side            resolved.Side          `json:"side"`
	Data            json.RawMessage        `json:"data,omitempty"`
}

type DexExchangeParam struct {
	NeedWrapNative                        bool              `json:"needWrapNative"`
	NeedUnwrapNative                      *bool             `json:"needUnwrapNative,omitempty"`
	SkipApproval                          *bool             `json:"skipApproval,omitempty"`
	WethAddress                           *resolved.Address `json:"wethAddress,omitempty"`
	ExchangeData                          resolved.HexBytes `json:"exchangeData"`
	TargetExchange                        resolved.Address  `json:"targetExchange"`
	DexFuncHasRecipient                   bool              `json:"dexFuncHasRecipient"`
	SpecialDexFlag                        *int              `json:"specialDexFlag,omitempty"`
	TransferSrcTokenBeforeSwap            *resolved.Address `json:"transferSrcTokenBeforeSwap,omitempty"`
	Spender                               *resolved.Address `json:"spender,omitempty"`
	SendEthButSupportsInsertFromAmount    *bool             `json:"sendEthButSupportsInsertFromAmount,omitempty"`
	SpecialDexSupportsInsertFromAmount    *bool             `json:"specialDexSupportsInsertFromAmount,omitempty"`
	SwappedAmountNotPresentInExchangeData *bool             `json:"swappedAmountNotPresentInExchangeData,omitempty"`
	ReturnAmountPos                       *int              `json:"returnAmountPos,omitempty"`
	InsertFromAmountPos                   *int              `json:"insertFromAmountPos,omitempty"`
	AmountsPacked128                      *bool             `json:"amountsPacked128,omitempty"`
	Permit2Approval                       *bool             `json:"permit2Approval,omitempty"`
}
