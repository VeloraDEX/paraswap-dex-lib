package executor

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type Executor03Builder struct {
	context resolved.EncodingContext
}

func NewExecutor03Builder(context resolved.EncodingContext) Executor03Builder {
	return Executor03Builder{context: context}
}

type executor03Flags struct {
	approves []flag
	dexes    []flag
	wrap     flag
}

type executor03OrderedExchange struct {
	exchangeParam     resolved.DexExchangeBuildParam
	swapExchange      resolved.RoutePlanSwapExchange
	swapExchangeIndex int
}

func (b Executor03Builder) BuildBytecode(input resolved.ExecutorBytecodeBuildInput) (resolved.HexBytes, error) {
	priceRoute := buildExecutorRoute(input)
	orderedLegs, err := getOrderedLegs(input)
	if err != nil {
		return "", err
	}
	if len(orderedLegs) == 0 {
		return "", fmt.Errorf("Executor03 requires at least one exchange param")
	}
	if err := b.validatePhase2dScope(priceRoute, orderedLegs, input.WethPlan); err != nil {
		return "", err
	}

	orderedExchanges := b.orderExchanges(orderedLegs)
	exchangeParams := make([]resolved.DexExchangeBuildParam, 0, len(orderedExchanges))
	for _, orderedExchange := range orderedExchanges {
		exchangeParams = append(exchangeParams, orderedExchange.exchangeParam)
	}

	flags, err := b.buildFlags(priceRoute, exchangeParams, input.WethPlan)
	if err != nil {
		return "", err
	}

	swap := priceRoute.BestRoute[0].Swaps[0]
	orderedSwap := swap
	orderedSwap.SwapExchanges = make([]resolved.RoutePlanSwapExchange, 0, len(orderedExchanges))
	for _, orderedExchange := range orderedExchanges {
		orderedSwap.SwapExchanges = append(orderedSwap.SwapExchanges, orderedExchange.swapExchange)
	}

	swapsCalldata := resolved.HexBytes("0x")
	for index, orderedExchange := range orderedExchanges {
		swapCallData, err := b.buildSingleSwapCallData(
			priceRoute,
			exchangeParams,
			index,
			flags,
			input.WethPlan,
			orderedExchange.swapExchangeIndex,
			orderedSwap,
		)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(swapCallData))
		if err != nil {
			return "", err
		}
	}

	return buildExecutor03TopLevelBytecode(swapsCalldata)
}

func (b Executor03Builder) validatePhase2dScope(
	priceRoute executorRoute,
	orderedLegs []orderedExecutorLeg,
	wethPlan *resolved.WethPlan,
) error {
	if len(priceRoute.BestRoute) != 1 {
		return fmt.Errorf("Executor03 Phase 2d supports a single route only")
	}
	if len(priceRoute.BestRoute[0].Swaps) != 1 {
		return fmt.Errorf("Executor03 Phase 2d supports a single swap only")
	}
	if wethPlan != nil {
		return fmt.Errorf("Executor03 WETH plan calldata is not implemented in Phase 2d")
	}

	for _, orderedLeg := range orderedLegs {
		if orderedLeg.RouteIndex != 0 || orderedLeg.SwapIndex != 0 {
			return fmt.Errorf("Executor03 Phase 2d supports only route position 0:0:*")
		}
		exchangeParam := orderedLeg.ResolvedLeg.ExchangeParam
		if !exchangeParam.DexFuncHasRecipient {
			return fmt.Errorf("Executor03 dexFuncHasRecipient=false is not implemented in Phase 2d")
		}
		if boolValue(exchangeParam.NeedUnwrapNative) {
			return fmt.Errorf("Executor03 needUnwrapNative is not implemented in Phase 2d")
		}
		if exchangeParam.WethAddress != nil {
			return fmt.Errorf("Executor03 custom wethAddress is not implemented in Phase 2d")
		}
		if exchangeParam.TransferSrcTokenBeforeSwap != nil {
			return fmt.Errorf("Executor03 transferSrcTokenBeforeSwap calldata is not implemented in Phase 2d")
		}
		if exchangeParam.Spender != nil {
			return fmt.Errorf("Executor03 spender override is not implemented in Phase 2d")
		}
		if boolValue(exchangeParam.SendEthButSupportsInsertFromAmount) {
			return fmt.Errorf("Executor03 sendEthButSupportsInsertFromAmount is not implemented in Phase 2d")
		}
		if exchangeParam.SpecialDexSupportsInsertFromAmount != nil {
			return fmt.Errorf("Executor03 special-dex insert support is not implemented in Phase 2d")
		}
		if boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) {
			return fmt.Errorf("Executor03 swappedAmountNotPresentInExchangeData is not implemented in Phase 2d")
		}
		if exchangeParam.ReturnAmountPos != nil {
			return fmt.Errorf("Executor03 returnAmountPos override is not implemented in Phase 2d")
		}
		if exchangeParam.InsertFromAmountPos != nil {
			return fmt.Errorf("Executor03 insertFromAmountPos override is not implemented in Phase 2d")
		}
		if boolValue(exchangeParam.AmountsPacked128) {
			return fmt.Errorf("Executor03 amountsPacked128 is not implemented in Phase 2d")
		}
		if boolValue(exchangeParam.Permit2Approval) {
			return fmt.Errorf("Executor03 permit2Approval is not implemented in Phase 2d")
		}
		if boolValue(exchangeParam.SkipApproval) {
			return fmt.Errorf("Executor03 skipApproval is not implemented in Phase 2d")
		}
		if exchangeParam.ApproveData != nil {
			return fmt.Errorf("Executor03 approve calldata is not implemented in Phase 2d")
		}
		if exchangeParam.SpecialDexFlag != nil && *exchangeParam.SpecialDexFlag != int(specialDexDefault) {
			return fmt.Errorf("Executor03 specialDexFlag is not implemented in Phase 2d")
		}
	}

	return nil
}

func (b Executor03Builder) orderExchanges(
	orderedLegs []orderedExecutorLeg,
) []executor03OrderedExchange {
	ordered := make([]executor03OrderedExchange, 0, len(orderedLegs))
	for _, orderedLeg := range orderedLegs {
		ordered = append(ordered, executor03OrderedExchange{
			exchangeParam:     orderedLeg.ResolvedLeg.ExchangeParam,
			swapExchange:      orderedLeg.SwapExchange,
			swapExchangeIndex: orderedLeg.SwapExchangeIndex,
		})
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		return !ordered[i].exchangeParam.NeedWrapNative.Value &&
			ordered[j].exchangeParam.NeedWrapNative.Value
	})
	return ordered
}

func (b Executor03Builder) buildFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	maybeWethCallData *resolved.WethPlan,
) (executor03Flags, error) {
	dexes := make([]flag, 0, len(exchangeParams))
	approves := make([]flag, 0, len(exchangeParams))
	exchangeParamIndex := 0
	for routeIndex, route := range priceRoute.BestRoute {
		for swapIndex, swap := range route.Swaps {
			for swapExchangeIndex := range swap.SwapExchanges {
				dexFlag, approveFlag, err := b.buildSimpleSwapFlags(
					priceRoute,
					exchangeParams,
					routeIndex,
					swapIndex,
					swapExchangeIndex,
					exchangeParamIndex,
					maybeWethCallData,
				)
				if err != nil {
					return executor03Flags{}, err
				}
				dexes = append(dexes, dexFlag)
				approves = append(approves, approveFlag)
				exchangeParamIndex++
			}
		}
	}

	wrapFlag := insertFromAmountCheckEthBalanceAfterSwap
	if isETHAddress(priceRoute.SrcToken) && maybeWethCallData != nil && maybeWethCallData.Deposit != nil {
		wrapFlag = sendEthEqualToFromAmountDontCheckBalanceAfterSwap
	}
	return executor03Flags{approves: approves, dexes: dexes, wrap: wrapFlag}, nil
}

func (b Executor03Builder) buildSimpleSwapFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParamIndex int,
	maybeWethCallData *resolved.WethPlan,
) (flag, flag, error) {
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	exchangeParam := exchangeParams[exchangeParamIndex]

	isEthSrc := isETHAddress(swap.SrcToken)
	isEthDest := isETHAddress(swap.DestToken)
	isSpecialDex := exchangeParam.SpecialDexFlag != nil &&
		*exchangeParam.SpecialDexFlag != int(specialDexDefault)
	forcePreventInsertFromAmount :=
		boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) ||
			(isSpecialDex && !boolValue(exchangeParam.SpecialDexSupportsInsertFromAmount))
	needWrap := exchangeParam.NeedWrapNative.Value &&
		isEthSrc &&
		maybeWethCallData != nil &&
		maybeWethCallData.Deposit != nil
	needUnwrap := exchangeParam.NeedWrapNative.Value &&
		isEthDest &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil

	dexFlag := insertFromAmountDontCheckBalanceAfterSwap
	if forcePreventInsertFromAmount {
		dexFlag = dontInsertFromAmountDontCheckBalanceAfterSwap
	}
	approveFlag := dontInsertFromAmountDontCheckBalanceAfterSwap

	if isEthSrc && !needWrap {
		preventInsertForSendEth :=
			forcePreventInsertFromAmount ||
				!boolValue(exchangeParam.SendEthButSupportsInsertFromAmount)
		if exchangeParam.DexFuncHasRecipient {
			if preventInsertForSendEth {
				dexFlag = sendEthEqualToFromAmountDontCheckBalanceAfterSwap
			} else {
				dexFlag = sendEthEqualToFromAmountPlusInsertFromAmountDontCheckBalanceAfterSwap
			}
		} else if preventInsertForSendEth {
			dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
		} else {
			dexFlag = sendEthEqualToFromAmountPlusInsertFromAmountCheckSrcTokenBalanceAfterSwap
		}
	} else if isEthDest && !needUnwrap {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckEthBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckEthBalanceAfterSwap
		}
	} else if isEthDest && needUnwrap {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckSrcTokenBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckSrcTokenBalanceAfterSwap
		}
	} else if !isETHAddress(swap.DestToken) && anyExchangeParamWithoutRecipient(exchangeParams) {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckSrcTokenBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckSrcTokenBalanceAfterSwap
		}
	}

	if boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.SrcToken, b.context) {
		dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
	} else if boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.DestToken, b.context) {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckEthBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckEthBalanceAfterSwap
		}
	}

	return dexFlag, approveFlag, nil
}

func (b Executor03Builder) buildSingleSwapCallData(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	index int,
	flags executor03Flags,
	maybeWethCallData *resolved.WethPlan,
	swapExchangeIndex int,
	swap resolved.RoutePlanSwap,
) (resolved.HexBytes, error) {
	curExchangeParam := exchangeParams[index]
	dexCallData, err := b.buildDexCallData(
		priceRoute,
		0,
		0,
		swapExchangeIndex,
		exchangeParams,
		index,
		flags.dexes[index],
		maybeWethCallData,
	)
	if err != nil {
		return "", err
	}

	swapCallData := dexCallData
	if boolValue(curExchangeParam.NeedUnwrapNative) &&
		(isWETHAddress(swap.SrcToken, b.context) || isWETHAddress(swap.DestToken, b.context)) {
		return "", fmt.Errorf("Executor03 needUnwrapNative calldata is not implemented in Phase 2d")
	}
	if curExchangeParam.TransferSrcTokenBeforeSwap != nil {
		return "", fmt.Errorf("Executor03 transferSrcTokenBeforeSwap calldata is not implemented in Phase 2d")
	}
	if curExchangeParam.ApproveData != nil || boolValue(curExchangeParam.Permit2Approval) {
		return "", fmt.Errorf("Executor03 approve calldata is not implemented in Phase 2d")
	}
	if maybeWethCallData != nil &&
		curExchangeParam.NeedWrapNative.Value &&
		isETHAddress(swap.SrcToken) {
		return "", fmt.Errorf("Executor03 WETH deposit calldata is not implemented in Phase 2d")
	}
	if index == len(exchangeParams)-1 &&
		isETHAddress(swap.DestToken) &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil {
		return "", fmt.Errorf("Executor03 final WETH withdraw calldata is not implemented in Phase 2d")
	}

	needWithdraw := anyExchangeParamNeedsWrapNative(exchangeParams) &&
		isETHAddress(swap.SrcToken)
	return b.addMetadata(
		swapCallData,
		swap.SwapExchanges[index].Percent,
		swap.SrcToken,
		swap.DestToken,
		needWithdraw,
	)
}

func (b Executor03Builder) buildDexCallData(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
	exchangeParamIndex int,
	dexFlag flag,
	maybeWethCallData *resolved.WethPlan,
) (resolved.HexBytes, error) {
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	swapExchange := swap.SwapExchanges[swapExchangeIndex]
	exchangeParam := exchangeParams[exchangeParamIndex]
	exchangeData := resolved.HexBytes(lowerHex(string(exchangeParam.ExchangeData)))

	var err error
	exchangeData, err = addTokenAddressToCallData(
		exchangeData,
		resolved.Address(lowerHex(string(swap.SrcToken))),
	)
	if err != nil {
		return "", err
	}
	exchangeData, err = addTokenAddressToCallData(
		exchangeData,
		resolved.Address(lowerHex(string(swap.DestToken))),
	)
	if err != nil {
		return "", err
	}

	if isETHAddress(swap.DestToken) &&
		exchangeParam.NeedWrapNative.Value &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil {
		exchangeData, err = addTokenAddressToCallData(
			exchangeData,
			resolved.Address(lowerHex(string(getWETHAddress(exchangeParam, b.context)))),
		)
		if err != nil {
			return "", err
		}
	}

	dontCheckBalanceAfterSwap := int(dexFlag)%3 == 0
	checkDestTokenBalanceAfterSwap := int(dexFlag)%3 == 2
	insertAmount := int(dexFlag)%4 != 0 && int(dexFlag)%4 != 1

	tokenBalanceCheckPos := 0
	if checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap {
		destTokenAddr := resolved.Address(lowerHex(string(swap.DestToken)))
		if isETHAddress(swap.DestToken) {
			destTokenAddr = resolved.Address(lowerHex(string(getWETHAddress(exchangeParam, b.context))))
		}
		destTokenAddrIndex := strings.Index(
			strip0x(string(exchangeData)),
			strip0x(string(destTokenAddr)),
		)
		if destTokenAddrIndex == -1 {
			return "", fmt.Errorf("destination token address not found in exchangeData")
		}
		tokenBalanceCheckPos = (destTokenAddrIndex - 24) / 2
	}

	fromAmountPos := 0
	toAmountPos := 0
	if insertAmount {
		if exchangeParam.InsertFromAmountPos != nil {
			fromAmountPos = *exchangeParam.InsertFromAmountPos
		} else {
			fromAmountPos, err = b.findAmountPosWithFallback(
				exchangeData,
				swapExchange.SrcAmount,
			)
			if err != nil {
				return "", err
			}
		}
		toAmountPos, err = b.findAmountPosWithFallback(
			exchangeData,
			swapExchange.DestAmount,
		)
		if err != nil {
			return "", err
		}
	}

	specialFlag := specialDexDefault
	if exchangeParam.SpecialDexFlag != nil {
		specialFlag = specialDex(*exchangeParam.SpecialDexFlag)
	}

	return buildExecutor03CallData(
		exchangeParam.TargetExchange,
		exchangeData,
		fromAmountPos,
		tokenBalanceCheckPos,
		specialFlag,
		dexFlag,
		toAmountPos,
	)
}

func (b Executor03Builder) findAmountPosWithFallback(
	exchangeData resolved.HexBytes,
	amount resolved.DecimalString,
) (int, error) {
	positiveEncoded, err := encodeUint256Decimal(amount)
	if err != nil {
		return 0, err
	}
	pos := findAmountPosInCalldata(exchangeData, positiveEncoded)
	if pos < len(string(exchangeData))/2 {
		return pos, nil
	}

	negativeEncoded, err := encodeNegativeInt256Decimal(amount)
	if err != nil {
		return 0, err
	}
	return findAmountPosInCalldata(exchangeData, negativeEncoded), nil
}

func (b Executor03Builder) addMetadata(
	callData resolved.HexBytes,
	percentage float64,
	srcTokenAddress resolved.Address,
	destTokenAddress resolved.Address,
	needWithdraw bool,
) (resolved.HexBytes, error) {
	srcTokenAddressLowered := resolved.Address(lowerHex(string(srcTokenAddress)))
	destTokenAddressLowered := resolved.Address(lowerHex(string(destTokenAddress)))

	srcTokenAddrIndex := strings.Index(
		strip0x(string(callData)),
		strip0x(string(srcTokenAddressLowered)),
	)
	if srcTokenAddrIndex == -1 {
		return "", fmt.Errorf("source token address not found in Executor03 calldata")
	}
	srcTokenPos, err := leftPadUint(srcTokenAddrIndex/2, 8)
	if err != nil {
		return "", err
	}

	destTokenAddrIndex := strings.Index(
		strip0x(string(callData)),
		strip0x(string(destTokenAddressLowered)),
	)
	if destTokenAddrIndex == -1 {
		return "", fmt.Errorf("destination token address not found in Executor03 calldata")
	}
	destTokenPos, err := leftPadUint(destTokenAddrIndex/2, 8)
	if err != nil {
		return "", err
	}

	callDataLength, err := hexDataLength(string(callData))
	if err != nil {
		return "", err
	}
	calldataSize, err := leftPadUint(callDataLength, 4)
	if err != nil {
		return "", err
	}
	flagField := zeroBytes(4)
	if needWithdraw {
		flagField, err = leftPadUint(1, 4)
		if err != nil {
			return "", err
		}
	}
	percentageField, err := leftPadUint(int(math.Ceil(percentage*100)), 8)
	if err != nil {
		return "", err
	}

	return concatHex(
		calldataSize,
		flagField,
		destTokenPos,
		srcTokenPos,
		percentageField,
		string(callData),
	)
}

func anyExchangeParamWithoutRecipient(exchangeParams []resolved.DexExchangeBuildParam) bool {
	for _, exchangeParam := range exchangeParams {
		if !exchangeParam.DexFuncHasRecipient {
			return true
		}
	}
	return false
}

func anyExchangeParamNeedsWrapNative(exchangeParams []resolved.DexExchangeBuildParam) bool {
	for _, exchangeParam := range exchangeParams {
		if exchangeParam.NeedWrapNative.Value {
			return true
		}
	}
	return false
}
