package resolved

import "encoding/json"

type RoutePlan struct {
	Routes []RoutePlanRoute `json:"routes"`
}

type RoutePlanRoute struct {
	Percent float64         `json:"percent"`
	Swaps   []RoutePlanSwap `json:"swaps"`
}

type RoutePlanSwap struct {
	SrcToken      Address                 `json:"srcToken"`
	DestToken     Address                 `json:"destToken"`
	SrcAmount     DecimalString           `json:"srcAmount"`
	DestAmount    DecimalString           `json:"destAmount"`
	SwapExchanges []RoutePlanSwapExchange `json:"swapExchanges"`
}

type RoutePlanSwapExchange struct {
	Exchange   string        `json:"exchange"`
	Percent    float64       `json:"percent"`
	SrcAmount  DecimalString `json:"srcAmount"`
	DestAmount DecimalString `json:"destAmount"`
}

type RoutePlanExchange struct {
	RouteIndex        int
	SwapIndex         int
	SwapExchangeIndex int
	Route             RoutePlanRoute
	Swap              RoutePlanSwap
	SwapExchange      RoutePlanSwapExchange
}

type ResolvedLeg struct {
	RouteIndex           int                   `json:"routeIndex"`
	SwapIndex            int                   `json:"swapIndex"`
	SwapExchangeIndex    int                   `json:"swapExchangeIndex"`
	ExchangeParam        DexExchangeBuildParam `json:"exchangeParam"`
	NormalizedSrcToken   Address               `json:"normalizedSrcToken"`
	NormalizedDestToken  Address               `json:"normalizedDestToken"`
	NormalizedSrcAmount  DecimalString         `json:"normalizedSrcAmount"`
	NormalizedDestAmount DecimalString         `json:"normalizedDestAmount"`
	Recipient            Address               `json:"recipient"`
}

type DexExchangeBuildParam struct {
	NeedWrapNative                        RawBool      `json:"needWrapNative"`
	NeedUnwrapNative                      *bool        `json:"needUnwrapNative,omitempty"`
	SkipApproval                          *bool        `json:"skipApproval,omitempty"`
	WethAddress                           *Address     `json:"wethAddress,omitempty"`
	ExchangeData                          HexBytes     `json:"exchangeData"`
	TargetExchange                        Address      `json:"targetExchange"`
	DexFuncHasRecipient                   bool         `json:"dexFuncHasRecipient"`
	SpecialDexFlag                        *int         `json:"specialDexFlag,omitempty"`
	TransferSrcTokenBeforeSwap            *Address     `json:"transferSrcTokenBeforeSwap,omitempty"`
	Spender                               *Address     `json:"spender,omitempty"`
	SendEthButSupportsInsertFromAmount    *bool        `json:"sendEthButSupportsInsertFromAmount,omitempty"`
	SpecialDexSupportsInsertFromAmount    *bool        `json:"specialDexSupportsInsertFromAmount,omitempty"`
	SwappedAmountNotPresentInExchangeData *bool        `json:"swappedAmountNotPresentInExchangeData,omitempty"`
	ReturnAmountPos                       *int         `json:"returnAmountPos,omitempty"`
	InsertFromAmountPos                   *int         `json:"insertFromAmountPos,omitempty"`
	AmountsPacked128                      *bool        `json:"amountsPacked128,omitempty"`
	Permit2Approval                       *bool        `json:"permit2Approval,omitempty"`
	ApproveData                           *ApproveData `json:"approveData,omitempty"`
}

type ApproveData struct {
	Target Address `json:"target"`
	Token  Address `json:"token"`
}

// RawBool preserves whether a JSON boolean field was absent, present-but-invalid,
// or valid. Value is meaningful only when Present and Valid are both true.
type RawBool struct {
	Value   bool
	Valid   bool
	Present bool
}

func (b *RawBool) UnmarshalJSON(data []byte) error {
	b.Present = true

	var value bool
	if err := json.Unmarshal(data, &value); err != nil {
		b.Valid = false
		b.Value = false
		return nil
	}

	b.Valid = true
	b.Value = value
	return nil
}

type WethPlan struct {
	Deposit  *WethSubPlan `json:"deposit,omitempty"`
	Withdraw *WethSubPlan `json:"withdraw,omitempty"`
}

type WethSubPlan struct {
	Callee   Address       `json:"callee"`
	Calldata HexBytes      `json:"calldata"`
	Value    DecimalString `json:"value"`
}

type ExecutorBytecodeBuilder interface {
	BuildBytecode(input ExecutorBytecodeBuildInput) (HexBytes, error)
}

type ExecutorBytecodeBuilderFactory interface {
	CreateExecutorBytecodeBuilder(
		executorType ExecutorType,
		context EncodingContext,
	) (ExecutorBytecodeBuilder, error)
}

type ExecutorBytecodeBuildInput struct {
	ExecutorType ExecutorType
	Context      EncodingContext
	RoutePlan    RoutePlan
	ResolvedLegs []ResolvedLeg
	Sender       Address
	SrcToken     Address
	DestToken    Address
	DestAmount   DecimalString
	WethPlan     *WethPlan
}

type validatedBuildInput struct {
	input            BuildInput
	routePlan        RoutePlan
	resolvedLegs     []ResolvedLeg
	wethPlan         *WethPlan
	fee              FeeInput
	resolvedLegByKey map[string]ResolvedLeg
}
