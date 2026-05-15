package executor

import (
	"fmt"
	"math"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type Executor02Builder struct {
	context resolved.EncodingContext
}

func NewExecutor02Builder(context resolved.EncodingContext) Executor02Builder {
	return Executor02Builder{context: context}
}

type executor02Flags struct {
	approves []flag
	dexes    []flag
	wrap     flag
}

func (b Executor02Builder) BuildBytecode(input resolved.ExecutorBytecodeBuildInput) (resolved.HexBytes, error) {
	priceRoute := buildExecutorRoute(input)
	exchangeParams, err := getExchangeParams(input)
	if err != nil {
		return "", err
	}
	if len(exchangeParams) == 0 {
		return "", fmt.Errorf("Executor02 requires at least one exchange param")
	}
	if err := b.validatePhase2cScope(priceRoute, exchangeParams); err != nil {
		return "", err
	}

	maybeWethCallData := input.WethPlan
	isMegaSwap := len(priceRoute.BestRoute) > 1
	isMultiSwap := !isMegaSwap && len(priceRoute.BestRoute[0].Swaps) > 1
	needWrapEth := maybeWethCallData != nil &&
		maybeWethCallData.Deposit != nil &&
		isETHAddress(priceRoute.SrcToken)
	needUnwrapEth := maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil &&
		isETHAddress(priceRoute.DestToken)
	needSendNativeEth := isETHAddress(priceRoute.DestToken)
	routeNeedsRootWrapEth := b.doesRouteNeedsRootWrapEth(priceRoute, exchangeParams)
	routeNeedsRootUnwrapEth := b.doesRouteNeedsRootUnwrapEth(priceRoute, exchangeParams)

	flags, err := b.buildFlags(priceRoute, exchangeParams, maybeWethCallData)
	if err != nil {
		return "", err
	}

	swapsCalldata := resolved.HexBytes("0x")
	for routeIndex, route := range priceRoute.BestRoute {
		routeCallData, err := b.buildSingleRouteCallData(
			priceRoute,
			exchangeParams,
			route,
			routeIndex,
			flags,
			maybeWethCallData,
		)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(routeCallData))
		if err != nil {
			return "", err
		}
	}

	if isMegaSwap && (needWrapEth || needUnwrapEth) {
		lastRoute := priceRoute.BestRoute[len(priceRoute.BestRoute)-1]
		lastSwap := lastRoute.Swaps[len(lastRoute.Swaps)-1]
		rootFlag := dontInsertFromAmountDontCheckBalanceAfterSwap
		if !needWrapEth {
			rootFlag = dontInsertFromAmountCheckSrcTokenBalanceAfterSwap
		}
		swapsCalldata, err = b.buildVerticalBranchingCallData(
			priceRoute,
			len(priceRoute.BestRoute)-1,
			len(lastRoute.Swaps)-1,
			exchangeParams,
			lastSwap,
			swapsCalldata,
			rootFlag,
			true,
		)
		if err != nil {
			return "", err
		}
	}

	if needWrapEth && routeNeedsRootWrapEth {
		if isMegaSwap || isMultiSwap {
			depositCallData, err := buildWrapEthCallData(
				b.context.WrappedNativeTokenAddress,
				maybeWethCallData.Deposit.Calldata,
				sendEthEqualToFromAmountDontCheckBalanceAfterSwap,
				0,
			)
			if err != nil {
				return "", err
			}
			swapsCalldata, err = concatHex(string(depositCallData), string(swapsCalldata))
			if err != nil {
				return "", err
			}
		} else {
			return "", fmt.Errorf("Executor02 non-multi root deposit wrapper is not implemented in Phase 2c")
		}
	}

	if needUnwrapEth && routeNeedsRootUnwrapEth && (isMultiSwap || isMegaSwap) {
		withdrawCallData, err := buildUnwrapEthCallData(
			b.context.WrappedNativeTokenAddress,
			maybeWethCallData.Withdraw.Calldata,
		)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(withdrawCallData))
		if err != nil {
			return "", err
		}
	}

	if needSendNativeEth && routeNeedsRootUnwrapEth && (isMultiSwap || isMegaSwap) {
		finalSpecialFlagCalldata, err := buildFinalSpecialFlagCalldata(b.context)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(finalSpecialFlagCalldata))
		if err != nil {
			return "", err
		}
	}

	if ((needWrapEth || needUnwrapEth) && isMegaSwap) || isMultiSwap {
		swapsCalldata, err = b.addMultiSwapMetadata(
			priceRoute,
			exchangeParams,
			swapsCalldata,
			swapExchange100Percentage,
			priceRoute.BestRoute[0].Swaps[0],
			0,
			0,
			notExistingExchangeParamIndex,
			false,
			false,
		)
		if err != nil {
			return "", err
		}
	}

	return buildExecutor01TopLevelBytecode(swapsCalldata)
}

func (b Executor02Builder) validatePhase2cScope(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
) error {
	for index, exchangeParam := range exchangeParams {
		if boolValue(exchangeParam.NeedUnwrapNative) {
			return fmt.Errorf("Executor02 needUnwrapNative is not implemented in Phase 2c")
		}
		if exchangeParam.WethAddress != nil {
			return fmt.Errorf("Executor02 custom wethAddress is not implemented in Phase 2c")
		}
		if exchangeParam.TransferSrcTokenBeforeSwap != nil {
			return fmt.Errorf("Executor02 transferSrcTokenBeforeSwap calldata is not implemented in Phase 2c")
		}
		if exchangeParam.Spender != nil {
			return fmt.Errorf("Executor02 spender override is not implemented in Phase 2c")
		}
		if boolValue(exchangeParam.SendEthButSupportsInsertFromAmount) {
			return fmt.Errorf("Executor02 sendEthButSupportsInsertFromAmount is not implemented in Phase 2c")
		}
		if exchangeParam.SpecialDexSupportsInsertFromAmount != nil {
			return fmt.Errorf("Executor02 special-dex insert support is not implemented in Phase 2c")
		}
		if boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) {
			return fmt.Errorf("Executor02 swappedAmountNotPresentInExchangeData is not implemented in Phase 2c")
		}
		if exchangeParam.ReturnAmountPos != nil {
			return fmt.Errorf("Executor02 returnAmountPos override is not implemented in Phase 2c")
		}
		if exchangeParam.InsertFromAmountPos != nil {
			return fmt.Errorf("Executor02 insertFromAmountPos override is not implemented in Phase 2c")
		}
		if boolValue(exchangeParam.AmountsPacked128) {
			return fmt.Errorf("Executor02 amountsPacked128 is not implemented in Phase 2c")
		}
		if boolValue(exchangeParam.Permit2Approval) {
			return fmt.Errorf("Executor02 permit2Approval is not implemented in Phase 2c")
		}
		if boolValue(exchangeParam.SkipApproval) {
			return fmt.Errorf("Executor02 skipApproval is not implemented in Phase 2c")
		}
		if exchangeParam.ApproveData != nil {
			return fmt.Errorf("Executor02 approve calldata is not implemented in Phase 2c")
		}
		if exchangeParam.SpecialDexFlag != nil && *exchangeParam.SpecialDexFlag != int(specialDexDefault) {
			return fmt.Errorf("Executor02 specialDexFlag is not implemented in Phase 2c")
		}
		if !exchangeParam.DexFuncHasRecipient {
			routePosition, ok := routePositionForExchangeParamIndex(priceRoute, index)
			if !ok {
				return fmt.Errorf("missing route position for exchange param index %d", index)
			}
			isLastSwap := routePosition.SwapIndex ==
				len(priceRoute.BestRoute[routePosition.RouteIndex].Swaps)-1
			if !isLastSwap || routePosition.Swap.DestToken != priceRoute.DestToken {
				return fmt.Errorf("Executor02 non-terminal dexFuncHasRecipient=false is not implemented in Phase 2c")
			}
		}
	}
	return nil
}

func (b Executor02Builder) buildFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	maybeWethCallData *resolved.WethPlan,
) (executor02Flags, error) {
	isMegaSwap := len(priceRoute.BestRoute) > 1
	isMultiSwap := !isMegaSwap && len(priceRoute.BestRoute[0].Swaps) > 1

	dexes := make([]flag, 0, len(exchangeParams))
	approves := make([]flag, 0, len(exchangeParams))
	exchangeParamIndex := 0
	for routeIndex, route := range priceRoute.BestRoute {
		for swapIndex, swap := range route.Swaps {
			for swapExchangeIndex := range swap.SwapExchanges {
				var dexFlag flag
				var approveFlag flag
				var err error
				if isMultiSwap || isMegaSwap {
					dexFlag, approveFlag, err = b.buildMultiMegaSwapFlags(
						priceRoute,
						exchangeParams,
						routeIndex,
						swapIndex,
						swapExchangeIndex,
						exchangeParamIndex,
						maybeWethCallData,
					)
				} else {
					dexFlag, approveFlag, err = b.buildSimpleSwapFlags(
						priceRoute,
						exchangeParams,
						routeIndex,
						swapIndex,
						swapExchangeIndex,
						exchangeParamIndex,
						maybeWethCallData,
					)
				}
				if err != nil {
					return executor02Flags{}, err
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
	return executor02Flags{approves: approves, dexes: dexes, wrap: wrapFlag}, nil
}

func (b Executor02Builder) buildSimpleSwapFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParamIndex int,
	maybeWethCallData *resolved.WethPlan,
) (flag, flag, error) {
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	isEthSrc := isETHAddress(swap.SrcToken)
	isEthDest := isETHAddress(swap.DestToken)
	exchangeParam := exchangeParams[exchangeParamIndex]

	needWrap := exchangeParam.NeedWrapNative.Value &&
		isEthSrc &&
		maybeWethCallData != nil &&
		maybeWethCallData.Deposit != nil
	needUnwrap := exchangeParam.NeedWrapNative.Value &&
		isEthDest &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil

	dexFlag := insertFromAmountDontCheckBalanceAfterSwap
	approveFlag := dontInsertFromAmountDontCheckBalanceAfterSwap
	if isEthSrc && !needWrap {
		if exchangeParam.DexFuncHasRecipient {
			dexFlag = sendEthEqualToFromAmountDontCheckBalanceAfterSwap
		} else {
			dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
		}
	} else if isEthDest && !needUnwrap {
		dexFlag = insertFromAmountCheckEthBalanceAfterSwap
	} else if !exchangeParam.DexFuncHasRecipient || (isEthDest && needUnwrap) {
		dexFlag = insertFromAmountCheckSrcTokenBalanceAfterSwap
	}

	return dexFlag, approveFlag, nil
}

func (b Executor02Builder) buildMultiMegaSwapFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParamIndex int,
	maybeWethCallData *resolved.WethPlan,
) (flag, flag, error) {
	route := priceRoute.BestRoute[routeIndex]
	swap := route.Swaps[swapIndex]
	exchangeParam := exchangeParams[exchangeParamIndex]

	applyVerticalBranching := b.doesSwapNeedToApplyVerticalBranching(priceRoute, routeIndex, swap)
	isHorizontalSequence := len(route.Swaps) > 1
	isFirstSwap := swapIndex == 0
	isLastSwap := !isFirstSwap && swapIndex == len(route.Swaps)-1

	isEthSrc := isETHAddress(swap.SrcToken)
	isEthDest := isETHAddress(swap.DestToken)
	needUnwrap := exchangeParam.NeedWrapNative.Value &&
		isEthDest &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil
	needSendEth := isEthSrc && !exchangeParam.NeedWrapNative.Value
	needCheckEthBalance := isEthDest && !exchangeParam.NeedWrapNative.Value
	anyDexOnSwapDoesntNeedWrapNative := b.anyDexOnSwapDoesntNeedWrapNative(
		priceRoute,
		routeIndex,
		swapIndex,
		exchangeParams,
	)
	isLastExchangeWithNeedWrapNative := b.isLastExchangeWithNeedWrapNative(
		priceRoute,
		routeIndex,
		swapIndex,
		exchangeParams,
		exchangeParamIndex,
	)

	forceBalanceOfCheck := !exchangeParam.DexFuncHasRecipient
	needCheckSrcTokenBalanceOf :=
		(needUnwrap &&
			(!applyVerticalBranching ||
				(applyVerticalBranching && anyDexOnSwapDoesntNeedWrapNative)) &&
			(isLastExchangeWithNeedWrapNative || exchangeParam.WethAddress != nil)) ||
			(isHorizontalSequence && !applyVerticalBranching && !isLastSwap)

	dexFlag := insertFromAmountDontCheckBalanceAfterSwap
	approveFlag := dontInsertFromAmountDontCheckBalanceAfterSwap
	if needSendEth {
		if needCheckSrcTokenBalanceOf || forceBalanceOfCheck {
			dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
		} else if exchangeParam.DexFuncHasRecipient {
			dexFlag = sendEthEqualToFromAmountDontCheckBalanceAfterSwap
		} else {
			dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
		}
	} else if needCheckEthBalance {
		if needCheckSrcTokenBalanceOf || forceBalanceOfCheck {
			dexFlag = insertFromAmountCheckEthBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountDontCheckBalanceAfterSwap
		}
	} else {
		if needCheckSrcTokenBalanceOf || forceBalanceOfCheck {
			dexFlag = insertFromAmountCheckSrcTokenBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountDontCheckBalanceAfterSwap
		}
	}

	return dexFlag, approveFlag, nil
}

func (b Executor02Builder) buildDexCallData(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
	exchangeParamIndex int,
	dexFlag flag,
) (resolved.HexBytes, error) {
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	swapExchange := swap.SwapExchanges[swapExchangeIndex]
	exchangeParam := exchangeParams[exchangeParamIndex]
	exchangeData := resolved.HexBytes(lowerHex(string(exchangeParam.ExchangeData)))
	routeNeedsRootUnwrapEth := b.doesRouteNeedsRootUnwrapEth(priceRoute, exchangeParams)
	needUnwrap := b.isLastExchangeWithNeedWrapNative(
		priceRoute,
		routeIndex,
		swapIndex,
		exchangeParams,
		exchangeParamIndex,
	) || exchangeParam.WethAddress != nil
	needUnwrapAfterLastSwapInRoute :=
		needUnwrap &&
			isETHAddress(swap.DestToken) &&
			b.anyDexOnSwapDoesntNeedWrapNative(priceRoute, routeIndex, swapIndex, exchangeParams)

	returnAmountPos := defaultReturnAmountPos
	if exchangeParam.ReturnAmountPos != nil &&
		!routeNeedsRootUnwrapEth &&
		!needUnwrapAfterLastSwapInRoute {
		returnAmountPos = *exchangeParam.ReturnAmountPos
	}

	applyVerticalBranching := b.doesSwapNeedToApplyVerticalBranching(priceRoute, routeIndex, swap)
	// Executor flags pack balance-check behavior in flag%3 and amount insertion
	// behavior in flag%4. Keep this arithmetic aligned with TS Executor02.
	dontCheckBalanceAfterSwap := int(dexFlag)%3 == 0
	checkDestTokenBalanceAfterSwap := int(dexFlag)%3 == 2
	insertFromAmount := int(dexFlag)%4 == 3 || int(dexFlag)%4 == 2

	srcTokenAddress := resolved.Address(lowerHex(string(swap.SrcToken)))
	if isETHAddress(swap.SrcToken) && exchangeParam.NeedWrapNative.Value {
		srcTokenAddress = resolved.Address(lowerHex(string(getWETHAddress(exchangeParam, b.context))))
	}
	destTokenAddress := resolved.Address(lowerHex(string(swap.DestToken)))
	if isETHAddress(swap.DestToken) && exchangeParam.NeedWrapNative.Value {
		destTokenAddress = resolved.Address(lowerHex(string(getWETHAddress(exchangeParam, b.context))))
	}

	var err error
	exchangeData, err = addTokenAddressToCallData(exchangeData, srcTokenAddress)
	if err != nil {
		return "", err
	}
	if applyVerticalBranching || (checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap) {
		exchangeData, err = addTokenAddressToCallData(exchangeData, destTokenAddress)
		if err != nil {
			return "", err
		}
	}

	destTokenPos := 0
	if checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap {
		destTokenAddrIndex := strings.Index(
			strip0x(string(exchangeData)),
			strip0x(string(destTokenAddress)),
		)
		if destTokenAddrIndex == -1 {
			return "", fmt.Errorf("destination token address not found in exchangeData")
		}
		destTokenPos = (destTokenAddrIndex - 24) / 2
	}

	fromAmountPos := 0
	if insertFromAmount {
		if exchangeParam.InsertFromAmountPos != nil {
			fromAmountPos = *exchangeParam.InsertFromAmountPos
		} else {
			encodedAmount, err := encodeUint256Decimal(swapExchange.SrcAmount)
			if err != nil {
				return "", err
			}
			fromAmountPos = findAmountPosInCalldata(exchangeData, encodedAmount)
		}
	}

	specialFlag := specialDexDefault
	if exchangeParam.SpecialDexFlag != nil {
		specialFlag = specialDex(*exchangeParam.SpecialDexFlag)
	}

	return buildExecutor0102CallData(
		exchangeParam.TargetExchange,
		exchangeData,
		fromAmountPos,
		destTokenPos,
		specialFlag,
		dexFlag,
		returnAmountPos,
	)
}

func (b Executor02Builder) buildSingleSwapExchangeCallData(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
	flags executor02Flags,
	addedWrapToSwapExchangeMap map[string]bool,
	allowToAddWrap bool,
	prevBranchWasWrapped bool,
	unwrapToSwapMap map[int]bool,
	maybeWethCallData *resolved.WethPlan,
	shouldAddMultiSwapMetadata bool,
	applyVerticalBranching bool,
) (resolved.HexBytes, error) {
	isSimpleSwap := len(priceRoute.BestRoute) == 1 && len(priceRoute.BestRoute[0].Swaps) == 1
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	swapExchange := swap.SwapExchanges[swapExchangeIndex]
	exchangeParamIndex := exchangeParamIndexForPosition(priceRoute, routeIndex, swapIndex, swapExchangeIndex)
	if exchangeParamIndex < 0 || exchangeParamIndex >= len(exchangeParams) {
		return "", fmt.Errorf("missing exchange param for route position %d:%d:%d", routeIndex, swapIndex, swapExchangeIndex)
	}
	curExchangeParam := exchangeParams[exchangeParamIndex]
	// Phase 2c scope guards reject NeedUnwrapNative, custom WETH, transfer
	// before swap, and approvals. Restore the corresponding TS branches when
	// those guards are relaxed in a later phase.

	dexCallData, err := b.buildDexCallData(
		priceRoute,
		routeIndex,
		swapIndex,
		swapExchangeIndex,
		exchangeParams,
		exchangeParamIndex,
		flags.dexes[exchangeParamIndex],
	)
	if err != nil {
		return "", err
	}

	swapExchangeCallData := dexCallData
	isLastSwap := swapIndex == len(priceRoute.BestRoute[routeIndex].Swaps)-1

	if curExchangeParam.NeedWrapNative.Value && isETHAddress(swap.SrcToken) {
		isNotFirstSwap := swapIndex != 0
		skipWrap := false
		if isNotFirstSwap {
			anyDexOnSwapDoesntNeedWrapNative := b.anyDexOnSwapDoesntNeedWrapNative(
				priceRoute,
				routeIndex,
				swapIndex-1,
				exchangeParams,
			)
			skipWrap = !anyDexOnSwapDoesntNeedWrapNative
		}

		depositCallData := resolved.HexBytes("0x")
		mapKey := swapExchangeMapKey(routeIndex, swapIndex, swapExchangeIndex)
		if maybeWethCallData != nil &&
			maybeWethCallData.Deposit != nil &&
			!b.doesRouteNeedsRootWrapEth(priceRoute, exchangeParams) &&
			allowToAddWrap &&
			!addedWrapToSwapExchangeMap[mapKey] &&
			!skipWrap {
			depositCallData, err = buildWrapEthCallData(
				getWETHAddress(curExchangeParam, b.context),
				maybeWethCallData.Deposit.Calldata,
				sendEthEqualToFromAmountDontCheckBalanceAfterSwap,
				0,
			)
			if err != nil {
				return "", err
			}
			addedWrapToSwapExchangeMap[mapKey] = true
		}

		swapExchangeCallData, err = concatHex(string(depositCallData), string(swapExchangeCallData))
		if err != nil {
			return "", err
		}
	}

	if curExchangeParam.NeedWrapNative.Value &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil &&
		((!applyVerticalBranching && isETHAddress(swap.DestToken)) ||
			(applyVerticalBranching &&
				isETHAddress(swap.DestToken) &&
				b.anyDexOnSwapDoesntNeedWrapNative(priceRoute, routeIndex, swapIndex, exchangeParams))) {
		withdrawCallData := resolved.HexBytes("0x")
		needUnwrapAll := isSimpleSwap
		if !needUnwrapAll {
			if isLastSwap {
				needUnwrapAll = !b.doesRouteNeedsRootUnwrapEth(priceRoute, exchangeParams)
			} else {
				needUnwrapAll =
					b.everyDexOnSwapNeedWrapNative(priceRoute, routeIndex, swapIndex+1, exchangeParams) ||
						b.everyDexOnSwapDoesntNeedWrapNative(priceRoute, routeIndex, swapIndex+1, exchangeParams)
			}
		}
		needUnwrap := needUnwrapAll &&
			b.isLastExchangeWithNeedWrapNative(
				priceRoute,
				routeIndex,
				swapIndex,
				exchangeParams,
				exchangeParamIndex,
			)
		// TS also unwraps for customWethAddress. Phase 2c rejects custom WETH
		// addresses before bytecode generation; restore that OR when enabled.
		if needUnwrap {
			unwrapToSwapMap[swapIndex] = true
			withdrawCallData, err = buildUnwrapEthCallData(
				getWETHAddress(curExchangeParam, b.context),
				maybeWethCallData.Withdraw.Calldata,
			)
			if err != nil {
				return "", err
			}
		}
		swapExchangeCallData, err = concatHex(string(swapExchangeCallData), string(withdrawCallData))
		if err != nil {
			return "", err
		}
		// TS also appends final send-native calldata for customWethAddress.
		// Phase 2c rejects custom WETH addresses before this branch.
		if isSimpleSwap && needUnwrap {
			finalSpecialFlagCalldata, err := buildFinalSpecialFlagCalldata(b.context)
			if err != nil {
				return "", err
			}
			swapExchangeCallData, err = concatHex(string(swapExchangeCallData), string(finalSpecialFlagCalldata))
			if err != nil {
				return "", err
			}
		}
	}

	addedUnwrapForDexWithNoNeedWrapNative := false
	if isETHAddress(swap.SrcToken) &&
		maybeWethCallData != nil &&
		maybeWethCallData.Withdraw != nil &&
		!curExchangeParam.NeedWrapNative.Value &&
		!unwrapToSwapMap[swapIndex-1] {
		var eachDexOnPrevSwapReturnsWeth bool
		if swapIndex > 0 && !prevBranchWasWrapped {
			eachDexOnPrevSwapReturnsWeth = b.eachDexOnSwapNeedsWrapNative(
				priceRoute,
				routeIndex,
				swapIndex-1,
				exchangeParams,
			)
		}
		if prevBranchWasWrapped || eachDexOnPrevSwapReturnsWeth {
			withdrawCallData, err := buildUnwrapEthCallData(
				getWETHAddress(curExchangeParam, b.context),
				maybeWethCallData.Withdraw.Calldata,
			)
			if err != nil {
				return "", err
			}
			swapExchangeCallData, err = concatHex(string(withdrawCallData), string(swapExchangeCallData))
			if err != nil {
				return "", err
			}
			addedUnwrapForDexWithNoNeedWrapNative = true
		}
	}

	if isLastSwap &&
		!curExchangeParam.DexFuncHasRecipient &&
		!isETHAddress(swap.DestToken) &&
		priceRoute.DestToken == swap.DestToken {
		transferCallData, err := buildERC20TransferCalldata(
			b.context.AugustusV6Address,
			swapExchange.DestAmount,
		)
		if err != nil {
			return "", err
		}
		wrappedTransferCallData, err := buildTransferCallData(transferCallData, swap.DestToken)
		if err != nil {
			return "", err
		}
		swapExchangeCallData, err = concatHex(string(swapExchangeCallData), string(wrappedTransferCallData))
		if err != nil {
			return "", err
		}
	}

	if !curExchangeParam.DexFuncHasRecipient &&
		isETHAddress(swap.DestToken) &&
		isLastSwap &&
		!b.doesRouteNeedsRootUnwrapEth(priceRoute, exchangeParams) {
		finalSpecialFlagCalldata, err := buildFinalSpecialFlagCalldata(b.context)
		if err != nil {
			return "", err
		}
		swapExchangeCallData, err = concatHex(string(swapExchangeCallData), string(finalSpecialFlagCalldata))
		if err != nil {
			return "", err
		}
	}

	if shouldAddMultiSwapMetadata {
		return b.addMultiSwapMetadata(
			priceRoute,
			exchangeParams,
			swapExchangeCallData,
			swapExchange.Percent,
			swap,
			routeIndex,
			swapIndex,
			exchangeParamIndex,
			addedWrapToSwapExchangeMap[swapExchangeMapKey(routeIndex, swapIndex, swapExchangeIndex)],
			addedUnwrapForDexWithNoNeedWrapNative,
		)
	}

	return swapExchangeCallData, nil
}

func (b Executor02Builder) appendWrapEthCallData(
	accumulator resolved.HexBytes,
	maybeWethCallData *resolved.WethPlan,
	checkWethBalanceAfter bool,
) (resolved.HexBytes, error) {
	if maybeWethCallData == nil || maybeWethCallData.Deposit == nil {
		return accumulator, nil
	}

	depositInput := maybeWethCallData.Deposit.Calldata
	destTokenPos := 0
	wrapFlag := sendEthEqualToFromAmountDontCheckBalanceAfterSwap
	if checkWethBalanceAfter {
		var err error
		depositInput, err = addTokenAddressToCallData(
			depositInput,
			b.context.WrappedNativeTokenAddress,
		)
		if err != nil {
			return "", err
		}
		wrapFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
		destTokenPos = 4
	}

	wrappedDeposit, err := buildWrapEthCallData(
		b.context.WrappedNativeTokenAddress,
		depositInput,
		wrapFlag,
		destTokenPos,
	)
	if err != nil {
		return "", err
	}
	return concatHex(string(accumulator), string(wrappedDeposit))
}

func (b Executor02Builder) buildSingleSwapCallData(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	flags executor02Flags,
	wrapToSwapExchangeMap map[string]bool,
	wrapToSwapMap map[int]bool,
	unwrapToSwapMap map[int]bool,
	maybeWethCallData *resolved.WethPlan,
	swap resolved.RoutePlanSwap,
) (resolved.HexBytes, error) {
	isLastSwap := swapIndex == len(priceRoute.BestRoute[routeIndex].Swaps)-1
	isMegaSwap := len(priceRoute.BestRoute) > 1
	isMultiSwap := !isMegaSwap && len(priceRoute.BestRoute[routeIndex].Swaps) > 1
	applyVerticalBranching := b.doesSwapNeedToApplyVerticalBranching(priceRoute, routeIndex, swap)
	anyDexOnSwapDoesntNeedWrapNative := b.anyDexOnSwapDoesntNeedWrapNative(
		priceRoute,
		routeIndex,
		swapIndex,
		exchangeParams,
	)
	needToAppendWrapCallData :=
		isETHAddress(swap.DestToken) &&
			anyDexOnSwapDoesntNeedWrapNative &&
			!isLastSwap &&
			maybeWethCallData != nil &&
			maybeWethCallData.Deposit != nil

	swapCallData := resolved.HexBytes("0x")
	for swapExchangeIndex := range swap.SwapExchanges {
		part, err := b.buildSingleSwapExchangeCallData(
			priceRoute,
			routeIndex,
			swapIndex,
			swapExchangeIndex,
			exchangeParams,
			flags,
			wrapToSwapExchangeMap,
			!wrapToSwapMap[swapIndex-1],
			wrapToSwapMap[swapIndex-1],
			unwrapToSwapMap,
			maybeWethCallData,
			len(swap.SwapExchanges) > 1,
			applyVerticalBranching,
		)
		if err != nil {
			return "", err
		}
		var concatErr error
		swapCallData, concatErr = concatHex(string(swapCallData), string(part))
		if concatErr != nil {
			return "", concatErr
		}
	}

	if needToAppendWrapCallData {
		wrapToSwapMap[swapIndex] = true
	}

	if !isMultiSwap && !isMegaSwap {
		if needToAppendWrapCallData {
			return b.appendWrapEthCallData(swapCallData, maybeWethCallData, false)
		}
		return swapCallData, nil
	}

	if applyVerticalBranching {
		vertBranchingCallData, err := b.buildVerticalBranchingCallData(
			priceRoute,
			routeIndex,
			swapIndex,
			exchangeParams,
			swap,
			swapCallData,
			b.buildVerticalBranchingFlag(
				priceRoute,
				swap,
				exchangeParams,
				routeIndex,
				swapIndex,
			),
			false,
		)
		if err != nil {
			return "", err
		}
		if needToAppendWrapCallData {
			return b.appendWrapEthCallData(vertBranchingCallData, maybeWethCallData, true)
		}
		return vertBranchingCallData, nil
	}

	if needToAppendWrapCallData {
		return b.appendWrapEthCallData(swapCallData, maybeWethCallData, false)
	}
	return swapCallData, nil
}

func (b Executor02Builder) buildSingleRouteCallData(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	route resolved.RoutePlanRoute,
	routeIndex int,
	flags executor02Flags,
	maybeWethCallData *resolved.WethPlan,
) (resolved.HexBytes, error) {
	isMegaSwap := len(priceRoute.BestRoute) > 1
	addedWrapToSwapExchangeMap := make(map[string]bool)
	addedWrapToSwapMap := make(map[int]bool)
	unwrapToSwapMap := make(map[int]bool)
	callData := resolved.HexBytes("0x")
	for swapIndex, swap := range route.Swaps {
		swapCallData, err := b.buildSingleSwapCallData(
			priceRoute,
			exchangeParams,
			routeIndex,
			swapIndex,
			flags,
			addedWrapToSwapExchangeMap,
			addedWrapToSwapMap,
			unwrapToSwapMap,
			maybeWethCallData,
			swap,
		)
		if err != nil {
			return "", err
		}
		callData, err = concatHex(string(callData), string(swapCallData))
		if err != nil {
			return "", err
		}
	}

	routeDoesntNeedToAddMultiSwapMetadata :=
		len(route.Swaps) == 1 &&
			len(route.Swaps[0].SwapExchanges) != 1 &&
			!b.doesSwapNeedToApplyVerticalBranching(priceRoute, routeIndex, route.Swaps[0])
	if isMegaSwap && !routeDoesntNeedToAddMultiSwapMetadata {
		return b.addMultiSwapMetadata(
			priceRoute,
			exchangeParams,
			callData,
			route.Percent,
			route.Swaps[0],
			routeIndex,
			0,
			notExistingExchangeParamIndex,
			anyBoolValue(addedWrapToSwapMap) || anyBoolValue(addedWrapToSwapExchangeMap),
			false,
		)
	}

	return callData, nil
}

func (b Executor02Builder) addMultiSwapMetadata(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	callData resolved.HexBytes,
	percentage float64,
	swap resolved.RoutePlanSwap,
	routeIndex int,
	swapIndex int,
	exchangeParamIndex int,
	wrapWasAddedInSwapExchange bool,
	addedUnwrapForDexWithNoNeedWrapNative bool,
) (resolved.HexBytes, error) {
	srcTokenAddress := swap.SrcToken

	var doesAnyDexOnSwapNeedsWrapNative bool
	if exchangeParamIndex >= 0 {
		exchangeParam := exchangeParams[exchangeParamIndex]
		doesAnyDexOnSwapNeedsWrapNative =
			isETHAddress(srcTokenAddress) &&
				(exchangeParam.NeedWrapNative.Value ||
					(!exchangeParam.NeedWrapNative.Value && addedUnwrapForDexWithNoNeedWrapNative))
	} else {
		doesAnyDexOnSwapNeedsWrapNative =
			isETHAddress(srcTokenAddress) &&
				b.anyDexOnSwapNeedsWrapNative(priceRoute, routeIndex, swapIndex, exchangeParams)
	}

	if doesAnyDexOnSwapNeedsWrapNative &&
		isETHAddress(srcTokenAddress) &&
		!wrapWasAddedInSwapExchange {
		if exchangeParamIndex >= 0 {
			srcTokenAddress = getWETHAddress(exchangeParams[exchangeParamIndex], b.context)
		} else {
			srcTokenAddress = b.context.WrappedNativeTokenAddress
		}
	}

	srcTokenAddressLowered := resolved.Address(lowerHex(string(srcTokenAddress)))
	var srcTokenPos string
	if percentage == swapExchange100Percentage {
		srcTokenPos = zeroBytes(8)
	} else if isETHAddress(srcTokenAddressLowered) {
		srcTokenPos = ethSrcTokenPosForMultiswapMetadata
	} else {
		srcTokenAddrIndex := strings.Index(
			strings.ToLower(strip0x(string(callData))),
			strip0x(string(srcTokenAddressLowered)),
		)
		if srcTokenAddrIndex < 0 {
			return "", fmt.Errorf("source token address not found in multiswap calldata")
		}
		var err error
		srcTokenPos, err = leftPadUint(srcTokenAddrIndex/2, 8)
		if err != nil {
			return "", err
		}
	}

	callDataLength, err := hexDataLength(string(callData))
	if err != nil {
		return "", err
	}
	callDataSize, err := leftPadUint(callDataLength, 16)
	if err != nil {
		return "", err
	}
	percentageField, err := leftPadUint(int(math.Round(percentage*100)), 8)
	if err != nil {
		return "", err
	}

	return concatHex(callDataSize, srcTokenPos, percentageField, string(callData))
}

func (b Executor02Builder) packVerticalBranchingData(
	swapCallData resolved.HexBytes,
) (resolved.HexBytes, error) {
	callDataLength, err := hexDataLength(string(swapCallData))
	if err != nil {
		return "", err
	}
	offset, err := leftPadUint(32, 32)
	if err != nil {
		return "", err
	}
	length, err := leftPadUint(callDataLength, 32)
	if err != nil {
		return "", err
	}
	return concatHex(zeroBytes(28), zeroBytes(4), offset, length, string(swapCallData))
}

func (b Executor02Builder) packVerticalBranchingCallData(
	verticalBranchingData resolved.HexBytes,
	fromAmountPos int,
	destTokenPos int,
	dexFlag flag,
) (resolved.HexBytes, error) {
	verticalBranchingLength, err := hexDataLength(string(verticalBranchingData))
	if err != nil {
		return "", err
	}
	lengthField, err := leftPadUint(verticalBranchingLength, 4)
	if err != nil {
		return "", err
	}
	fromAmountField, err := leftPadUint(fromAmountPos, 2)
	if err != nil {
		return "", err
	}
	destTokenField, err := leftPadUint(destTokenPos, 2)
	if err != nil {
		return "", err
	}
	returnAmountField, err := leftPadUint(0, 1)
	if err != nil {
		return "", err
	}
	specialField, err := leftPadUint(int(specialDexExecuteVerticalBranching), 1)
	if err != nil {
		return "", err
	}
	flagField, err := leftPadUint(int(dexFlag), 2)
	if err != nil {
		return "", err
	}
	return concatHex(
		zeroBytes(20),
		lengthField,
		fromAmountField,
		destTokenField,
		returnAmountField,
		specialField,
		flagField,
		string(verticalBranchingData),
	)
}

func (b Executor02Builder) buildVerticalBranchingCallData(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
	swap resolved.RoutePlanSwap,
	swapCallData resolved.HexBytes,
	dexFlag flag,
	isRoot bool,
) (resolved.HexBytes, error) {
	data, err := b.packVerticalBranchingData(swapCallData)
	if err != nil {
		return "", err
	}

	destTokenAddrLowered := resolved.Address(lowerHex(string(swap.DestToken)))
	isEthDest := isETHAddress(destTokenAddrLowered)
	anyDexOnSwapNeedsWrapNative := false
	anyDexOnSwapDoesntNeedWrapNative := false
	if isEthDest {
		if !isRoot {
			anyDexOnSwapNeedsWrapNative = b.anyDexOnSwapNeedsWrapNative(
				priceRoute,
				routeIndex,
				swapIndex,
				exchangeParams,
			)
			anyDexOnSwapDoesntNeedWrapNative = b.anyDexOnSwapDoesntNeedWrapNative(
				priceRoute,
				routeIndex,
				swapIndex,
				exchangeParams,
			)
		} else {
			for routeIndex, route := range priceRoute.BestRoute {
				lastSwapIndex := len(route.Swaps) - 1
				if b.anyDexOnSwapNeedsWrapNative(priceRoute, routeIndex, lastSwapIndex, exchangeParams) {
					anyDexOnSwapNeedsWrapNative = true
				}
				if b.anyDexOnSwapDoesntNeedWrapNative(priceRoute, routeIndex, lastSwapIndex, exchangeParams) {
					anyDexOnSwapDoesntNeedWrapNative = true
				}
			}
		}
	}

	destTokenPos := 0
	if !(isEthDest && anyDexOnSwapDoesntNeedWrapNative && !anyDexOnSwapNeedsWrapNative) {
		searchToken := destTokenAddrLowered
		if isEthDest {
			searchToken = resolved.Address(lowerHex(string(b.context.WrappedNativeTokenAddress)))
		}
		destTokenAddrIndex := strings.Index(
			strip0x(string(data)),
			strip0x(string(searchToken)),
		)
		destTokenPos = destTokenAddrIndex/2 - 40
		// TS clamps negative positions, including not-found indexes, to zero
		// for vertical-branch wrappers.
		if destTokenPos < 0 {
			destTokenPos = 0
		}
	}

	dataLength, err := hexDataLength(string(data))
	if err != nil {
		return "", err
	}
	fromAmountPos := dataLength - 64 - 28
	return b.packVerticalBranchingCallData(data, fromAmountPos, destTokenPos, dexFlag)
}

func (b Executor02Builder) buildVerticalBranchingFlag(
	priceRoute executorRoute,
	swap resolved.RoutePlanSwap,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
) flag {
	dexFlag := insertFromAmountCheckSrcTokenBalanceAfterSwap
	isLastSwap := swapIndex == len(priceRoute.BestRoute[routeIndex].Swaps)-1
	if isLastSwap {
		isEthDest := isETHAddress(priceRoute.DestToken)
		anyDexLastSwapNeedUnwrap := b.anyDexOnSwapNeedsWrapNative(
			priceRoute,
			routeIndex,
			len(priceRoute.BestRoute[routeIndex].Swaps)-1,
			exchangeParams,
		)
		noNeedUnwrap := isEthDest && !anyDexLastSwapNeedUnwrap
		if noNeedUnwrap || !isEthDest {
			dexFlag = insertFromAmountDontCheckBalanceAfterSwap
		}
	} else if isETHAddress(swap.DestToken) &&
		b.anyDexOnSwapDoesntNeedWrapNative(priceRoute, routeIndex, swapIndex, exchangeParams) {
		dexFlag = insertFromAmountCheckEthBalanceAfterSwap
	}
	return dexFlag
}

func (b Executor02Builder) eachDexOnSwapNeedsWrapNative(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	indexes := exchangeParamIndexesForSwap(priceRoute, routeIndex, swapIndex)
	if len(indexes) == 0 {
		return false
	}
	for _, index := range indexes {
		exchangeParam := exchangeParams[index]
		if !exchangeParam.NeedWrapNative.Value || exchangeParam.WethAddress != nil {
			return false
		}
	}
	return true
}

func (b Executor02Builder) anyDexOnSwapNeedsWrapNative(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	for _, index := range exchangeParamIndexesForSwap(priceRoute, routeIndex, swapIndex) {
		exchangeParam := exchangeParams[index]
		if exchangeParam.NeedWrapNative.Value && exchangeParam.WethAddress == nil {
			return true
		}
	}
	return false
}

func (b Executor02Builder) anyDexOnSwapDoesntNeedWrapNative(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	for _, index := range exchangeParamIndexesForSwap(priceRoute, routeIndex, swapIndex) {
		if !exchangeParams[index].NeedWrapNative.Value {
			return true
		}
	}
	return false
}

func (b Executor02Builder) everyDexOnSwapNeedWrapNative(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	indexes := exchangeParamIndexesForSwap(priceRoute, routeIndex, swapIndex)
	if len(indexes) == 0 {
		return false
	}
	for _, index := range indexes {
		if !exchangeParams[index].NeedWrapNative.Value {
			return false
		}
	}
	return true
}

func (b Executor02Builder) everyDexOnSwapDoesntNeedWrapNative(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	indexes := exchangeParamIndexesForSwap(priceRoute, routeIndex, swapIndex)
	if len(indexes) == 0 {
		return false
	}
	for _, index := range indexes {
		if exchangeParams[index].NeedWrapNative.Value {
			return false
		}
	}
	return true
}

func (b Executor02Builder) isLastExchangeWithNeedWrapNative(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	exchangeParams []resolved.DexExchangeBuildParam,
	exchangeParamIndex int,
) bool {
	indexes := exchangeParamIndexesForSwap(priceRoute, routeIndex, swapIndex)
	for i := len(indexes) - 1; i >= 0; i-- {
		index := indexes[i]
		if exchangeParams[index].NeedWrapNative.Value {
			return index == exchangeParamIndex
		}
	}
	return false
}

func (b Executor02Builder) doesSwapNeedToApplyVerticalBranching(
	priceRoute executorRoute,
	routeIndex int,
	swap resolved.RoutePlanSwap,
) bool {
	isMegaSwap := len(priceRoute.BestRoute) > 1
	isMultiSwap := !isMegaSwap && len(priceRoute.BestRoute[routeIndex].Swaps) > 1
	return (isMultiSwap || isMegaSwap) && len(swap.SwapExchanges) > 1
}

func (b Executor02Builder) doesRouteNeedsRootWrapEth(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	if !isETHAddress(priceRoute.SrcToken) {
		return false
	}
	for routeIndex, route := range priceRoute.BestRoute {
		if len(route.Swaps) == 0 {
			return false
		}
		if !b.eachDexOnSwapNeedsWrapNative(priceRoute, routeIndex, 0, exchangeParams) {
			return false
		}
	}
	return true
}

func (b Executor02Builder) doesRouteNeedsRootUnwrapEth(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
) bool {
	if !isETHAddress(priceRoute.DestToken) {
		return false
	}
	for routeIndex, route := range priceRoute.BestRoute {
		if len(route.Swaps) == 0 {
			continue
		}
		lastSwapIndex := len(route.Swaps) - 1
		if b.anyDexOnSwapNeedsWrapNative(priceRoute, routeIndex, lastSwapIndex, exchangeParams) {
			return true
		}
	}
	return false
}

func exchangeParamIndexForPosition(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
) int {
	index := 0
	for curRouteIndex, route := range priceRoute.BestRoute {
		for curSwapIndex, swap := range route.Swaps {
			for curSwapExchangeIndex := range swap.SwapExchanges {
				if curRouteIndex == routeIndex &&
					curSwapIndex == swapIndex &&
					curSwapExchangeIndex == swapExchangeIndex {
					return index
				}
				index++
			}
		}
	}
	return -1
}

func routePositionForExchangeParamIndex(
	priceRoute executorRoute,
	exchangeParamIndex int,
) (resolved.RoutePlanExchange, bool) {
	index := 0
	for routeIndex, route := range priceRoute.BestRoute {
		for swapIndex, swap := range route.Swaps {
			for swapExchangeIndex, swapExchange := range swap.SwapExchanges {
				if index == exchangeParamIndex {
					return resolved.RoutePlanExchange{
						RouteIndex:        routeIndex,
						SwapIndex:         swapIndex,
						SwapExchangeIndex: swapExchangeIndex,
						Route:             route,
						Swap:              swap,
						SwapExchange:      swapExchange,
					}, true
				}
				index++
			}
		}
	}
	return resolved.RoutePlanExchange{}, false
}

func exchangeParamIndexesForSwap(
	priceRoute executorRoute,
	routeIndex int,
	swapIndex int,
) []int {
	if routeIndex < 0 ||
		routeIndex >= len(priceRoute.BestRoute) ||
		swapIndex < 0 ||
		swapIndex >= len(priceRoute.BestRoute[routeIndex].Swaps) {
		return nil
	}
	targetSwap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	indexes := make([]int, 0, len(targetSwap.SwapExchanges))
	index := 0
	for curRouteIndex, route := range priceRoute.BestRoute {
		for curSwapIndex, swap := range route.Swaps {
			for range swap.SwapExchanges {
				if curRouteIndex == routeIndex && curSwapIndex == swapIndex {
					indexes = append(indexes, index)
				}
				index++
			}
		}
	}
	return indexes
}

func swapExchangeMapKey(routeIndex, swapIndex, swapExchangeIndex int) string {
	return fmt.Sprintf("%d_%d_%d", routeIndex, swapIndex, swapExchangeIndex)
}

func anyBoolValue[K comparable](values map[K]bool) bool {
	for _, value := range values {
		if value {
			return true
		}
	}
	return false
}
