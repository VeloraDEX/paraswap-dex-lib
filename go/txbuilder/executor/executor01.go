package executor

import (
	"fmt"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type Executor01Builder struct {
	context resolved.EncodingContext
}

func NewExecutor01Builder(context resolved.EncodingContext) Executor01Builder {
	return Executor01Builder{context: context}
}

type executor01Flags struct {
	approves []flag
	dexes    []flag
	wrap     flag
}

func (b Executor01Builder) BuildBytecode(input resolved.ExecutorBytecodeBuildInput) (resolved.HexBytes, error) {
	priceRoute := buildExecutorRoute(input)
	exchangeParams, err := getExchangeParams(input)
	if err != nil {
		return "", err
	}
	if len(exchangeParams) == 0 {
		return "", fmt.Errorf("Executor01 requires at least one exchange param")
	}
	if err := b.validatePhase2eScope(priceRoute, exchangeParams, input.WethPlan); err != nil {
		return "", err
	}

	flags, err := b.buildFlags(priceRoute, exchangeParams, input.WethPlan)
	if err != nil {
		return "", err
	}

	swapsCalldata := resolved.HexBytes("0x")
	for index := range exchangeParams {
		swapCallData, err := b.buildSingleSwapCallData(
			priceRoute,
			exchangeParams,
			index,
			flags,
			input.WethPlan,
		)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(swapCallData))
		if err != nil {
			return "", err
		}
	}

	lastParam := exchangeParams[len(exchangeParams)-1]
	// Phase 2e rejects dexFuncHasRecipient=false before bytecode generation.
	// Re-verify these no-recipient trailers before relaxing that scope guard.
	if !lastParam.DexFuncHasRecipient && !isETHAddress(priceRoute.DestToken) {
		transferCallData, err := buildERC20TransferCalldata(
			b.context.AugustusV6Address,
			priceRoute.DestAmount,
		)
		if err != nil {
			return "", err
		}
		wrappedTransferCallData, err := buildTransferCallData(
			transferCallData,
			priceRoute.DestToken,
		)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(wrappedTransferCallData))
		if err != nil {
			return "", err
		}
	}
	// Final native-send trailer is live for ETH-destination WETH withdraw
	// fixtures; the no-recipient ETH-destination arm remains scope-guarded.
	if (input.WethPlan != nil && input.WethPlan.Withdraw != nil && isETHAddress(priceRoute.DestToken)) ||
		(!lastParam.DexFuncHasRecipient && isETHAddress(priceRoute.DestToken)) {
		finalSpecialFlagCalldata, err := buildFinalSpecialFlagCalldata(b.context)
		if err != nil {
			return "", err
		}
		swapsCalldata, err = concatHex(string(swapsCalldata), string(finalSpecialFlagCalldata))
		if err != nil {
			return "", err
		}
	}

	return buildExecutor01TopLevelBytecode(swapsCalldata)
}

func (b Executor01Builder) validatePhase2eScope(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	wethPlan *resolved.WethPlan,
) error {
	if len(priceRoute.BestRoute) != 1 {
		return fmt.Errorf("Executor01 does not support routes with multiple entries; mega-swap uses Executor02/Executor03")
	}

	exchangeParamIndex := 0
	for _, route := range priceRoute.BestRoute {
		for _, swap := range route.Swaps {
			if len(swap.SwapExchanges) != 1 {
				return fmt.Errorf("Executor01 Phase 2e supports one swapExchange per swap")
			}
			if exchangeParamIndex >= len(exchangeParams) {
				return fmt.Errorf("missing exchange param for route position")
			}

			exchangeParam := exchangeParams[exchangeParamIndex]
			if !exchangeParam.NeedWrapNative.Value {
				return fmt.Errorf("Executor01 needWrapNative=false is not implemented in Phase 2e")
			}
			if !exchangeParam.DexFuncHasRecipient {
				return fmt.Errorf("Executor01 dexFuncHasRecipient=false is not implemented in Phase 2e")
			}
			if boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.DestToken, b.context) {
				return fmt.Errorf("Executor01 WETH-destination needUnwrapNative is not implemented in Phase 2e")
			}
			if boolValue(exchangeParam.NeedUnwrapNative) && !isWETHAddress(swap.SrcToken, b.context) {
				return fmt.Errorf("Executor01 needUnwrapNative is not implemented in Phase 2e")
			}
			if exchangeParam.WethAddress != nil {
				if !boolValue(exchangeParam.NeedUnwrapNative) ||
					!isWETHAddress(swap.SrcToken, b.context) ||
					!isWETHAddress(*exchangeParam.WethAddress, b.context) {
					return fmt.Errorf("Executor01 custom wethAddress is not implemented in Phase 2e")
				}
			}
			if exchangeParam.Spender != nil {
				return fmt.Errorf("Executor01 spender override is not implemented in Phase 2e")
			}
			if boolValue(exchangeParam.SendEthButSupportsInsertFromAmount) {
				return fmt.Errorf("Executor01 sendEthButSupportsInsertFromAmount is not implemented in Phase 2e")
			}
			if exchangeParam.SpecialDexSupportsInsertFromAmount != nil {
				return fmt.Errorf("Executor01 special-dex insert support is not implemented in Phase 2e")
			}
			if boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) {
				return fmt.Errorf("Executor01 swappedAmountNotPresentInExchangeData is not implemented in Phase 2e")
			}
			if exchangeParam.ReturnAmountPos != nil {
				return fmt.Errorf("Executor01 returnAmountPos override is not implemented in Phase 2e")
			}
			if exchangeParam.InsertFromAmountPos != nil {
				return fmt.Errorf("Executor01 insertFromAmountPos override is not implemented in Phase 2e")
			}
			if boolValue(exchangeParam.AmountsPacked128) {
				return fmt.Errorf("Executor01 amountsPacked128 is not implemented in Phase 2e")
			}
			if boolValue(exchangeParam.SkipApproval) {
				return fmt.Errorf("Executor01 skipApproval is not implemented in Phase 2e")
			}
			if exchangeParam.SpecialDexFlag != nil && *exchangeParam.SpecialDexFlag != int(specialDexDefault) {
				return fmt.Errorf("Executor01 specialDexFlag is not implemented in Phase 2e")
			}

			exchangeParamIndex++
		}
	}
	if exchangeParamIndex != len(exchangeParams) {
		return fmt.Errorf(
			"exchange param count mismatch: consumed %d, got %d",
			exchangeParamIndex,
			len(exchangeParams),
		)
	}

	return nil
}

func (b Executor01Builder) buildFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	wethPlan *resolved.WethPlan,
) (executor01Flags, error) {
	isMegaSwap := len(priceRoute.BestRoute) > 1
	if len(priceRoute.BestRoute) == 0 {
		return executor01Flags{}, fmt.Errorf("Executor01 route must contain at least one route")
	}
	isMultiSwap := !isMegaSwap && len(priceRoute.BestRoute[0].Swaps) > 1

	dexes := make([]flag, 0, len(exchangeParams))
	approves := make([]flag, 0, len(exchangeParams))

	exchangeParamIndex := 0
	for routeIndex, route := range priceRoute.BestRoute {
		for swapIndex, swap := range route.Swaps {
			for swapExchangeIndex := range swap.SwapExchanges {
				if exchangeParamIndex >= len(exchangeParams) {
					return executor01Flags{}, fmt.Errorf(
						"missing exchange param for route position %d:%d:%d",
						routeIndex,
						swapIndex,
						swapExchangeIndex,
					)
				}

				var dexFlag flag
				var approveFlag flag
				var err error
				if isMultiSwap || isMegaSwap {
					dexFlag, approveFlag, err = b.buildMultiMegaSwapFlags(
						priceRoute,
						exchangeParams,
						routeIndex,
						swapIndex,
						exchangeParamIndex,
						wethPlan,
					)
				} else {
					dexFlag, approveFlag, err = b.buildSimpleSwapFlags(
						priceRoute,
						exchangeParams,
						routeIndex,
						swapIndex,
						exchangeParamIndex,
						wethPlan,
					)
				}
				if err != nil {
					return executor01Flags{}, err
				}

				dexes = append(dexes, dexFlag)
				approves = append(approves, approveFlag)
				exchangeParamIndex++
			}
		}
	}

	if exchangeParamIndex != len(exchangeParams) {
		return executor01Flags{}, fmt.Errorf(
			"exchange param count mismatch: consumed %d, got %d",
			exchangeParamIndex,
			len(exchangeParams),
		)
	}

	wrapFlag := insertFromAmountCheckEthBalanceAfterSwap
	if isETHAddress(priceRoute.SrcToken) && wethPlan != nil && wethPlan.Deposit != nil {
		wrapFlag = sendEthEqualToFromAmountDontCheckBalanceAfterSwap
	}

	return executor01Flags{
		dexes:    dexes,
		approves: approves,
		wrap:     wrapFlag,
	}, nil
}

func (b Executor01Builder) buildSimpleSwapFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	exchangeParamIndex int,
	wethPlan *resolved.WethPlan,
) (flag, flag, error) {
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	exchangeParam := exchangeParams[exchangeParamIndex]
	isEthSrc := isETHAddress(swap.SrcToken)
	isEthDest := isETHAddress(swap.DestToken)
	isWETHSrc := boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.SrcToken, b.context)
	isWETHDest := boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.DestToken, b.context)
	needWrap := exchangeParam.NeedWrapNative.Value &&
		isEthSrc &&
		wethPlan != nil &&
		wethPlan.Deposit != nil
	needUnwrap := exchangeParam.NeedWrapNative.Value &&
		isEthDest &&
		wethPlan != nil &&
		wethPlan.Withdraw != nil
	isSpecialDex := exchangeParam.SpecialDexFlag != nil &&
		*exchangeParam.SpecialDexFlag != int(specialDexDefault)
	forcePreventInsertFromAmount :=
		boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) ||
			(isSpecialDex && !boolValue(exchangeParam.SpecialDexSupportsInsertFromAmount))

	dexFlag := insertFromAmountDontCheckBalanceAfterSwap
	if forcePreventInsertFromAmount {
		dexFlag = dontInsertFromAmountDontCheckBalanceAfterSwap
	}
	approveFlag := dontInsertFromAmountDontCheckBalanceAfterSwap

	if isEthSrc && !needWrap {
		if exchangeParam.DexFuncHasRecipient {
			if !boolValue(exchangeParam.SendEthButSupportsInsertFromAmount) {
				dexFlag = sendEthEqualToFromAmountDontCheckBalanceAfterSwap
			} else {
				dexFlag = sendEthEqualToFromAmountPlusInsertFromAmountDontCheckBalanceAfterSwap
			}
		} else if !boolValue(exchangeParam.SendEthButSupportsInsertFromAmount) {
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
	} else if !exchangeParam.DexFuncHasRecipient || (isEthDest && needUnwrap) {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckSrcTokenBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckSrcTokenBalanceAfterSwap
		}
	}

	if isWETHSrc {
		dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
	} else if isWETHDest {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckEthBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckEthBalanceAfterSwap
		}
	}

	return dexFlag, approveFlag, nil
}

func (b Executor01Builder) buildMultiMegaSwapFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	exchangeParamIndex int,
	wethPlan *resolved.WethPlan,
) (flag, flag, error) {
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	exchangeParam := exchangeParams[exchangeParamIndex]
	isLastSwap := swapIndex == len(priceRoute.BestRoute[routeIndex].Swaps)-1
	isEthSrc := isETHAddress(swap.SrcToken)
	isEthDest := isETHAddress(swap.DestToken)
	isWETHSrc := boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.SrcToken, b.context)
	isWETHDest := boolValue(exchangeParam.NeedUnwrapNative) && isWETHAddress(swap.DestToken, b.context)
	isSpecialDex := exchangeParam.SpecialDexFlag != nil &&
		*exchangeParam.SpecialDexFlag != int(specialDexDefault)
	forcePreventInsertFromAmount :=
		boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) ||
			(isSpecialDex && !boolValue(exchangeParam.SpecialDexSupportsInsertFromAmount))
	needUnwrap := exchangeParam.NeedWrapNative.Value &&
		isEthDest &&
		wethPlan != nil &&
		wethPlan.Withdraw != nil
	forceBalanceOfCheck := true
	if isLastSwap {
		forceBalanceOfCheck = !exchangeParam.DexFuncHasRecipient || needUnwrap
	}
	needSendEth := isEthSrc && !exchangeParam.NeedWrapNative.Value
	needCheckEthBalance := isEthDest && !exchangeParam.NeedWrapNative.Value
	needCheckSrcTokenBalanceOf := needUnwrap && !isLastSwap

	dexFlag := insertFromAmountDontCheckBalanceAfterSwap
	approveFlag := dontInsertFromAmountDontCheckBalanceAfterSwap
	if needSendEth {
		preventInsertForSendEth :=
			forcePreventInsertFromAmount ||
				!boolValue(exchangeParam.SendEthButSupportsInsertFromAmount)
		if forceBalanceOfCheck {
			if preventInsertForSendEth {
				dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
			} else {
				dexFlag = sendEthEqualToFromAmountPlusInsertFromAmountCheckSrcTokenBalanceAfterSwap
			}
		} else if exchangeParam.DexFuncHasRecipient {
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
	} else if needCheckEthBalance {
		if needCheckSrcTokenBalanceOf || forceBalanceOfCheck {
			if forcePreventInsertFromAmount && exchangeParam.DexFuncHasRecipient {
				dexFlag = dontInsertFromAmountCheckEthBalanceAfterSwap
			} else {
				dexFlag = insertFromAmountCheckEthBalanceAfterSwap
			}
		} else if forcePreventInsertFromAmount && exchangeParam.DexFuncHasRecipient {
			dexFlag = dontInsertFromAmountDontCheckBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountDontCheckBalanceAfterSwap
		}
	} else {
		if needCheckSrcTokenBalanceOf || forceBalanceOfCheck {
			if forcePreventInsertFromAmount {
				dexFlag = dontInsertFromAmountCheckSrcTokenBalanceAfterSwap
			} else {
				dexFlag = insertFromAmountCheckSrcTokenBalanceAfterSwap
			}
		} else if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountDontCheckBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountDontCheckBalanceAfterSwap
		}
	}

	if isWETHSrc {
		dexFlag = sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap
	} else if isWETHDest {
		if forcePreventInsertFromAmount {
			dexFlag = dontInsertFromAmountCheckEthBalanceAfterSwap
		} else {
			dexFlag = insertFromAmountCheckEthBalanceAfterSwap
		}
	}

	return dexFlag, approveFlag, nil
}

func (b Executor01Builder) buildSingleSwapCallData(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	index int,
	flags executor01Flags,
	wethPlan *resolved.WethPlan,
) (resolved.HexBytes, error) {
	if len(priceRoute.BestRoute) != 1 {
		return "", fmt.Errorf("Executor01 does not support routes with multiple entries; mega-swap uses Executor02/Executor03")
	}
	if index >= len(priceRoute.BestRoute[0].Swaps) {
		return "", fmt.Errorf("missing swap for exchange param index %d", index)
	}

	swap := priceRoute.BestRoute[0].Swaps[index]
	curExchangeParam := exchangeParams[index]
	dexCallData, err := b.buildDexCallData(
		priceRoute,
		exchangeParams,
		0,
		index,
		0,
		index,
		flags.dexes[index],
	)
	if err != nil {
		return "", err
	}

	swapCallData := dexCallData
	isWETHSrcUnwrap :=
		boolValue(curExchangeParam.NeedUnwrapNative) &&
			isWETHAddress(swap.SrcToken, b.context)
	if isWETHSrcUnwrap {
		withdrawRawCalldata, err := buildERC20WithdrawCalldata(swap.SwapExchanges[0].SrcAmount)
		if err != nil {
			return "", err
		}
		withdrawCallData, err := buildUnwrapEthCallData(
			getWETHAddress(curExchangeParam, b.context),
			withdrawRawCalldata,
		)
		if err != nil {
			return "", err
		}
		swapCallData, err = concatHex(string(withdrawCallData), string(dexCallData))
		if err != nil {
			return "", err
		}
	}

	if curExchangeParam.TransferSrcTokenBeforeSwap != nil {
		transferCallData, err := buildERC20TransferCalldata(
			*curExchangeParam.TransferSrcTokenBeforeSwap,
			swap.SwapExchanges[0].SrcAmount,
		)
		if err != nil {
			return "", err
		}
		tokenAddress := resolved.Address(lowerHex(string(swap.SrcToken)))
		if isETHAddress(swap.SrcToken) {
			tokenAddress = getWETHAddress(curExchangeParam, b.context)
		}
		wrappedTransferCallData, err := buildTransferCallData(transferCallData, tokenAddress)
		if err != nil {
			return "", err
		}
		swapCallData, err = concatHex(string(wrappedTransferCallData), string(swapCallData))
		if err != nil {
			return "", err
		}
	}

	if int(flags.dexes[index])%4 != 1 &&
		(!isETHAddress(swap.SrcToken) || (isETHAddress(swap.SrcToken) && index != 0)) &&
		curExchangeParam.TransferSrcTokenBeforeSwap == nil &&
		!boolValue(curExchangeParam.SkipApproval) &&
		curExchangeParam.ApproveData != nil {
		approveCallData, err := buildApproveCallData(
			b.context,
			curExchangeParam.ApproveData.Target,
			curExchangeParam.ApproveData.Token,
			flags.approves[index],
			boolValue(curExchangeParam.Permit2Approval),
			maxUint,
		)
		if err != nil {
			return "", err
		}
		swapCallData, err = concatHex(string(approveCallData), string(swapCallData))
		if err != nil {
			return "", err
		}
	}

	if curExchangeParam.NeedWrapNative.Value && wethPlan != nil {
		if wethPlan.Deposit != nil && isETHAddress(swap.SrcToken) {
			var prevExchangeParam *resolved.DexExchangeBuildParam
			if index > 0 {
				prevExchangeParam = &exchangeParams[index-1]
			}
			if prevExchangeParam == nil || !prevExchangeParam.NeedWrapNative.Value {
				approveWethCallData := resolved.HexBytes("0x")
				if curExchangeParam.ApproveData != nil &&
					curExchangeParam.TransferSrcTokenBeforeSwap == nil &&
					!boolValue(curExchangeParam.SkipApproval) {
					approveWethCallData, err = buildApproveCallData(
						b.context,
						curExchangeParam.ApproveData.Target,
						curExchangeParam.ApproveData.Token,
						flags.approves[index],
						boolValue(curExchangeParam.Permit2Approval),
						maxUint,
					)
					if err != nil {
						return "", err
					}
				}

				depositCallData, err := buildWrapEthCallData(
					getWETHAddress(curExchangeParam, b.context),
					wethPlan.Deposit.Calldata,
					sendEthEqualToFromAmountDontCheckBalanceAfterSwap,
					0,
				)
				if err != nil {
					return "", err
				}
				swapCallData, err = concatHex(
					string(approveWethCallData),
					string(depositCallData),
					string(swapCallData),
				)
				if err != nil {
					return "", err
				}
			}
		}

		if wethPlan.Withdraw != nil && isETHAddress(swap.DestToken) {
			var nextExchangeParam *resolved.DexExchangeBuildParam
			if index+1 < len(exchangeParams) {
				nextExchangeParam = &exchangeParams[index+1]
			}
			if nextExchangeParam == nil || !nextExchangeParam.NeedWrapNative.Value {
				withdrawCallData, err := buildUnwrapEthCallData(
					getWETHAddress(curExchangeParam, b.context),
					wethPlan.Withdraw.Calldata,
				)
				if err != nil {
					return "", err
				}
				swapCallData, err = concatHex(string(swapCallData), string(withdrawCallData))
				if err != nil {
					return "", err
				}
			}
		}
	}

	return swapCallData, nil
}

func (b Executor01Builder) buildDexCallData(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	swapExchangeIndex int,
	exchangeParamIndex int,
	dexFlag flag,
) (resolved.HexBytes, error) {
	exchangeParam := exchangeParams[exchangeParamIndex]
	swap := priceRoute.BestRoute[routeIndex].Swaps[swapIndex]
	exchangeData := resolved.HexBytes(lowerHex(string(exchangeParam.ExchangeData)))

	dontCheckBalanceAfterSwap := int(dexFlag)%3 == 0
	checkDestTokenBalanceAfterSwap := int(dexFlag)%3 == 2
	insertFromAmount := int(dexFlag)%4 == 3 || int(dexFlag)%4 == 2

	returnAmountPos := defaultReturnAmountPos
	if exchangeParam.ReturnAmountPos != nil {
		returnAmountPos = *exchangeParam.ReturnAmountPos
	}

	srcTokenPos := 0
	if checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap {
		destTokenAddress := swap.DestToken
		if isETHAddress(swap.DestToken) {
			destTokenAddress = getWETHAddress(exchangeParam, b.context)
		}
		lowercasedDestTokenAddress := resolved.Address(lowerHex(string(destTokenAddress)))

		var err error
		exchangeData, err = addTokenAddressToCallData(exchangeData, lowercasedDestTokenAddress)
		if err != nil {
			return "", err
		}
		rawIndex := strings.Index(strip0x(string(exchangeData)), strip0x(string(lowercasedDestTokenAddress)))
		if rawIndex == -1 {
			return "", fmt.Errorf("destination token address not found in exchangeData")
		}
		// 24 hex chars are the 12 zero bytes before an ABI-word address.
		srcTokenPos = (rawIndex - 24) / 2
	}

	fromAmountPos := 0
	if insertFromAmount {
		if exchangeParam.InsertFromAmountPos != nil {
			fromAmountPos = *exchangeParam.InsertFromAmountPos
		} else {
			encodedAmount, err := encodeUint256Decimal(
				swap.SwapExchanges[swapExchangeIndex].SrcAmount,
			)
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
		srcTokenPos,
		specialFlag,
		dexFlag,
		returnAmountPos,
	)
}
