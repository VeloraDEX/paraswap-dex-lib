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
	if err := b.validatePhase2bScope(priceRoute, exchangeParams, input.WethPlan); err != nil {
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
	if !lastParam.DexFuncHasRecipient && !isETHAddress(priceRoute.DestToken) {
		return "", fmt.Errorf("Executor01 final transfer calldata is not implemented in Phase 2b")
	}
	if input.WethPlan != nil && input.WethPlan.Withdraw != nil && isETHAddress(priceRoute.DestToken) {
		return "", fmt.Errorf("Executor01 final WETH withdraw calldata is not implemented in Phase 2b")
	}
	if !lastParam.DexFuncHasRecipient && isETHAddress(priceRoute.DestToken) {
		return "", fmt.Errorf("Executor01 final special-flag calldata is not implemented in Phase 2b")
	}

	return buildExecutor01TopLevelBytecode(swapsCalldata)
}

func (b Executor01Builder) validatePhase2bScope(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	wethPlan *resolved.WethPlan,
) error {
	if len(priceRoute.BestRoute) != 1 {
		return fmt.Errorf("Executor01 does not support routes with multiple entries; mega-swap uses Executor02/Executor03")
	}
	if wethPlan != nil {
		return fmt.Errorf("Executor01 WETH plan calldata is not implemented in Phase 2b")
	}

	exchangeParamIndex := 0
	for _, route := range priceRoute.BestRoute {
		for _, swap := range route.Swaps {
			if len(swap.SwapExchanges) != 1 {
				return fmt.Errorf("Executor01 Phase 2b supports one swapExchange per swap")
			}
			if exchangeParamIndex >= len(exchangeParams) {
				return fmt.Errorf("missing exchange param for route position")
			}

			exchangeParam := exchangeParams[exchangeParamIndex]
			if !exchangeParam.NeedWrapNative.Value {
				return fmt.Errorf("Executor01 needWrapNative=false is not implemented in Phase 2b")
			}
			if !exchangeParam.DexFuncHasRecipient {
				return fmt.Errorf("Executor01 dexFuncHasRecipient=false is not implemented in Phase 2b")
			}
			if boolValue(exchangeParam.NeedUnwrapNative) {
				return fmt.Errorf("Executor01 needUnwrapNative is not implemented in Phase 2b")
			}
			if exchangeParam.WethAddress != nil {
				return fmt.Errorf("Executor01 custom wethAddress is not implemented in Phase 2b")
			}
			if exchangeParam.TransferSrcTokenBeforeSwap != nil {
				return fmt.Errorf("Executor01 transferSrcTokenBeforeSwap calldata is not implemented in Phase 2b")
			}
			if exchangeParam.Spender != nil {
				return fmt.Errorf("Executor01 spender override is not implemented in Phase 2b")
			}
			if boolValue(exchangeParam.SendEthButSupportsInsertFromAmount) {
				return fmt.Errorf("Executor01 sendEthButSupportsInsertFromAmount is not implemented in Phase 2b")
			}
			if exchangeParam.SpecialDexSupportsInsertFromAmount != nil {
				return fmt.Errorf("Executor01 special-dex insert support is not implemented in Phase 2b")
			}
			if boolValue(exchangeParam.SwappedAmountNotPresentInExchangeData) {
				return fmt.Errorf("Executor01 swappedAmountNotPresentInExchangeData is not implemented in Phase 2b")
			}
			if exchangeParam.ReturnAmountPos != nil {
				return fmt.Errorf("Executor01 returnAmountPos override is not implemented in Phase 2b")
			}
			if exchangeParam.InsertFromAmountPos != nil {
				return fmt.Errorf("Executor01 insertFromAmountPos override is not implemented in Phase 2b")
			}
			if boolValue(exchangeParam.AmountsPacked128) {
				return fmt.Errorf("Executor01 amountsPacked128 is not implemented in Phase 2b")
			}
			if boolValue(exchangeParam.Permit2Approval) {
				return fmt.Errorf("Executor01 permit2Approval is not implemented in Phase 2b")
			}
			if boolValue(exchangeParam.SkipApproval) {
				return fmt.Errorf("Executor01 skipApproval is not implemented in Phase 2b")
			}
			if exchangeParam.ApproveData != nil {
				return fmt.Errorf("Executor01 approve calldata is not implemented in Phase 2b")
			}
			if exchangeParam.SpecialDexFlag != nil && *exchangeParam.SpecialDexFlag != int(specialDexDefault) {
				return fmt.Errorf("Executor01 specialDexFlag is not implemented in Phase 2b")
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
	return insertFromAmountDontCheckBalanceAfterSwap,
		dontInsertFromAmountDontCheckBalanceAfterSwap,
		nil
}

func (b Executor01Builder) buildMultiMegaSwapFlags(
	priceRoute executorRoute,
	exchangeParams []resolved.DexExchangeBuildParam,
	routeIndex int,
	swapIndex int,
	exchangeParamIndex int,
	wethPlan *resolved.WethPlan,
) (flag, flag, error) {
	isLastSwap := swapIndex == len(priceRoute.BestRoute[routeIndex].Swaps)-1
	if isLastSwap {
		return insertFromAmountDontCheckBalanceAfterSwap,
			dontInsertFromAmountDontCheckBalanceAfterSwap,
			nil
	}
	return insertFromAmountCheckSrcTokenBalanceAfterSwap,
		dontInsertFromAmountDontCheckBalanceAfterSwap,
		nil
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

	return b.buildDexCallData(
		priceRoute,
		exchangeParams,
		0,
		index,
		0,
		index,
		flags.dexes[index],
	)
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
