package executor

import (
	"fmt"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type executorRoute struct {
	BestRoute  []resolved.RoutePlanRoute
	SrcToken   resolved.Address
	DestToken  resolved.Address
	DestAmount resolved.DecimalString
}

type orderedExecutorLeg struct {
	resolved.RoutePlanExchange
	ResolvedLeg resolved.ResolvedLeg
}

func buildExecutorRoute(input resolved.ExecutorBytecodeBuildInput) executorRoute {
	return executorRoute{
		BestRoute:  input.RoutePlan.Routes,
		SrcToken:   input.SrcToken,
		DestToken:  input.DestToken,
		DestAmount: input.DestAmount,
	}
}

func getOrderedLegs(input resolved.ExecutorBytecodeBuildInput) ([]orderedExecutorLeg, error) {
	routePositions := resolved.WalkRoutePlan(input.RoutePlan)
	routeKeys := make(map[string]struct{}, len(routePositions))
	for _, routePosition := range routePositions {
		routeKeys[resolved.RoutePlanExchangeKey(routePosition)] = struct{}{}
	}

	resolvedLegByKey := make(map[string]resolved.ResolvedLeg, len(input.ResolvedLegs))
	duplicateKeys := make([]string, 0)
	duplicateSeen := make(map[string]struct{})
	extraKeys := make([]string, 0)
	extraSeen := make(map[string]struct{})

	for _, resolvedLeg := range input.ResolvedLegs {
		key := resolved.ResolvedLegRoutePositionKey(resolvedLeg)
		if _, ok := resolvedLegByKey[key]; ok {
			if _, seen := duplicateSeen[key]; !seen {
				duplicateKeys = append(duplicateKeys, key)
				duplicateSeen[key] = struct{}{}
			}
		}
		if _, ok := routeKeys[key]; !ok {
			if _, seen := extraSeen[key]; !seen {
				extraKeys = append(extraKeys, key)
				extraSeen[key] = struct{}{}
			}
		}
		resolvedLegByKey[key] = resolvedLeg
	}

	if len(duplicateKeys) > 0 {
		return nil, fmt.Errorf(
			"duplicate resolved leg route position(s): %s",
			strings.Join(duplicateKeys, ", "),
		)
	}
	if len(extraKeys) > 0 {
		return nil, fmt.Errorf(
			"resolved leg route position(s) not present in route plan: %s",
			strings.Join(extraKeys, ", "),
		)
	}

	ordered := make([]orderedExecutorLeg, 0, len(routePositions))
	for _, routePosition := range routePositions {
		key := resolved.RoutePlanExchangeKey(routePosition)
		resolvedLeg, ok := resolvedLegByKey[key]
		if !ok {
			return nil, fmt.Errorf("missing resolved leg for route position %s", key)
		}
		ordered = append(ordered, orderedExecutorLeg{
			RoutePlanExchange: routePosition,
			ResolvedLeg:       resolvedLeg,
		})
	}

	return ordered, nil
}

func getExchangeParams(input resolved.ExecutorBytecodeBuildInput) ([]resolved.DexExchangeBuildParam, error) {
	orderedLegs, err := getOrderedLegs(input)
	if err != nil {
		return nil, err
	}

	exchangeParams := make([]resolved.DexExchangeBuildParam, 0, len(orderedLegs))
	for _, orderedLeg := range orderedLegs {
		exchangeParams = append(exchangeParams, orderedLeg.ResolvedLeg.ExchangeParam)
	}
	return exchangeParams, nil
}

func buildExecutor0102CallData(
	tokenAddress resolved.Address,
	calldata resolved.HexBytes,
	fromAmountPos int,
	srcTokenPos int,
	special specialDex,
	dexFlag flag,
	returnAmountPos int,
) (resolved.HexBytes, error) {
	calldataLength, err := hexDataLength(string(calldata))
	if err != nil {
		return "", err
	}

	lengthField, err := leftPadUint(calldataLength+bytes28Length, 4)
	if err != nil {
		return "", err
	}
	fromAmountField, err := leftPadUint(fromAmountPos, 2)
	if err != nil {
		return "", err
	}
	srcTokenField, err := leftPadUint(srcTokenPos, 2)
	if err != nil {
		return "", err
	}
	returnAmountField, err := leftPadUint(returnAmountPos, 1)
	if err != nil {
		return "", err
	}
	specialField, err := leftPadUint(int(special), 1)
	if err != nil {
		return "", err
	}
	flagField, err := leftPadUint(int(dexFlag), 2)
	if err != nil {
		return "", err
	}

	return concatHex(
		string(tokenAddress),
		lengthField,
		fromAmountField,
		srcTokenField,
		returnAmountField,
		specialField,
		flagField,
		zeroBytes(bytes28Length),
		string(calldata),
	)
}

func buildExecutor03CallData(
	tokenAddress resolved.Address,
	calldata resolved.HexBytes,
	fromAmountPos int,
	destTokenPos int,
	special specialDex,
	dexFlag flag,
	toAmountPos int,
) (resolved.HexBytes, error) {
	calldataLength, err := hexDataLength(string(calldata))
	if err != nil {
		return "", err
	}

	lengthField, err := leftPadUint(calldataLength+bytes28Length, 2)
	if err != nil {
		return "", err
	}
	toAmountField, err := leftPadUint(toAmountPos, 2)
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
	specialField, err := leftPadUint(int(special), 2)
	if err != nil {
		return "", err
	}
	flagField, err := leftPadUint(int(dexFlag), 2)
	if err != nil {
		return "", err
	}

	return concatHex(
		string(tokenAddress),
		lengthField,
		toAmountField,
		fromAmountField,
		destTokenField,
		specialField,
		flagField,
		zeroBytes(bytes28Length),
		string(calldata),
	)
}

func buildExecutor01TopLevelBytecode(swapsCalldata resolved.HexBytes) (resolved.HexBytes, error) {
	swapsLength, err := hexDataLength(string(swapsCalldata))
	if err != nil {
		return "", err
	}
	offset, err := leftPadUint(32, 32)
	if err != nil {
		return "", err
	}
	length, err := leftPadUint(swapsLength+bytes64Length, 32)
	if err != nil {
		return "", err
	}
	return concatHex(offset, length, string(swapsCalldata))
}

func buildExecutor03TopLevelBytecode(swapsCalldata resolved.HexBytes) (resolved.HexBytes, error) {
	swapsLength, err := hexDataLength(string(swapsCalldata))
	if err != nil {
		return "", err
	}
	offset, err := leftPadUint(32, 32)
	if err != nil {
		return "", err
	}
	length, err := leftPadUint(swapsLength+bytes96Length, 32)
	if err != nil {
		return "", err
	}
	return concatHex(offset, length, string(swapsCalldata))
}

func findAmountPosInCalldata(exchangeData resolved.HexBytes, encodedAmount string) int {
	rawCalldata := strip0x(string(exchangeData))
	rawAmount := strip0x(encodedAmount)

	amountIndex := -1
	for searchStart := 0; searchStart < len(rawCalldata); {
		relativeIndex := strings.Index(rawCalldata[searchStart:], rawAmount)
		if relativeIndex == -1 {
			break
		}
		idx := searchStart + relativeIndex
		if (idx-functionSelectorLength)%bytes64Length == 0 {
			amountIndex = idx
			break
		}
		searchStart = idx + 1
	}

	if amountIndex == -1 {
		return len(string(exchangeData)) / 2
	}
	return amountIndex / 2
}

func addTokenAddressToCallData(
	callData resolved.HexBytes,
	tokenAddress resolved.Address,
) (resolved.HexBytes, error) {
	if strings.Contains(strip0x(string(callData)), strip0x(string(tokenAddress))) {
		return callData, nil
	}
	return concatHex(string(callData), zeroBytes(12), string(tokenAddress))
}

func buildWrapEthCallData(
	wethAddress resolved.Address,
	depositCallData resolved.HexBytes,
	dexFlag flag,
	destTokenPos int,
) (resolved.HexBytes, error) {
	return buildExecutor0102CallData(
		wethAddress,
		depositCallData,
		wrapUnwrapFromAmountPos,
		destTokenPos,
		specialDexDefault,
		dexFlag,
		defaultReturnAmountPos,
	)
}

func buildUnwrapEthCallData(
	wethAddress resolved.Address,
	withdrawCallData resolved.HexBytes,
) (resolved.HexBytes, error) {
	if _, err := hexDataLength(string(withdrawCallData)); err != nil {
		return "", err
	}
	return buildExecutor0102CallData(
		wethAddress,
		withdrawCallData,
		wrapUnwrapFromAmountPos,
		0,
		specialDexDefault,
		insertFromAmountCheckEthBalanceAfterSwap,
		defaultReturnAmountPos,
	)
}

func buildTransferCallData(
	transferCallData resolved.HexBytes,
	tokenAddress resolved.Address,
) (resolved.HexBytes, error) {
	if _, err := hexDataLength(string(transferCallData)); err != nil {
		return "", err
	}
	return buildExecutor0102CallData(
		tokenAddress,
		transferCallData,
		erc20TransferAmountPos,
		0,
		specialDexDefault,
		insertFromAmountDontCheckBalanceAfterSwap,
		defaultReturnAmountPos,
	)
}

func buildApproveCallData(
	context resolved.EncodingContext,
	spender resolved.Address,
	tokenAddress resolved.Address,
	dexFlag flag,
	permit2 bool,
	amount resolved.DecimalString,
) (resolved.HexBytes, error) {
	if permit2 {
		return buildPermit2CallData(context, spender, tokenAddress, dexFlag)
	}

	approveCalldata, err := buildERC20ApproveCalldata(spender, amount)
	if err != nil {
		return "", err
	}
	if int(dexFlag)%3 == 2 {
		approveCalldata, err = concatHex(string(approveCalldata), zeroBytes(12), string(tokenAddress))
		if err != nil {
			return "", err
		}
	}

	approvalCalldata, err := buildExecutor0102CallData(
		tokenAddress,
		approveCalldata,
		0,
		approveCalldataDestTokenPos,
		specialDexDefault,
		dexFlag,
		defaultReturnAmountPos,
	)
	if err != nil {
		return "", err
	}

	if amount != "0" && isDisabledMaxUnitApprovalToken(context.Network, tokenAddress) {
		resetCalldata, err := buildApproveCallData(
			context,
			spender,
			tokenAddress,
			dontInsertFromAmountDontCheckBalanceAfterSwap,
			false,
			resolved.DecimalString("0"),
		)
		if err != nil {
			return "", err
		}
		return concatHex(string(resetCalldata), string(approvalCalldata))
	}

	return approvalCalldata, nil
}

func buildPermit2CallData(
	context resolved.EncodingContext,
	spender resolved.Address,
	tokenAddress resolved.Address,
	dexFlag flag,
) (resolved.HexBytes, error) {
	approveData, err := buildERC20ApproveCalldata(resolved.Address(permit2Address), maxUint)
	if err != nil {
		return "", err
	}
	approvalCalldata, err := buildExecutor0102CallData(
		tokenAddress,
		approveData,
		0,
		approveCalldataDestTokenPos,
		specialDexDefault,
		dontInsertFromAmountDontCheckBalanceAfterSwap,
		defaultReturnAmountPos,
	)
	if err != nil {
		return "", err
	}

	if isDisabledMaxUnitApprovalToken(context.Network, tokenAddress) {
		resetApprove, err := buildERC20ApproveCalldata(resolved.Address(permit2Address), "0")
		if err != nil {
			return "", err
		}
		resetCalldata, err := buildExecutor0102CallData(
			tokenAddress,
			resetApprove,
			0,
			approveCalldataDestTokenPos,
			specialDexDefault,
			dontInsertFromAmountDontCheckBalanceAfterSwap,
			defaultReturnAmountPos,
		)
		if err != nil {
			return "", err
		}
		approvalCalldata, err = concatHex(string(resetCalldata), string(approvalCalldata))
		if err != nil {
			return "", err
		}
	}

	permit2Data, err := buildPermit2ApproveCalldata(
		tokenAddress,
		spender,
		maxUint160,
		maxUint48,
	)
	if err != nil {
		return "", err
	}
	permit2Calldata, err := buildExecutor0102CallData(
		resolved.Address(permit2Address),
		permit2Data,
		0,
		approveCalldataDestTokenPos,
		specialDexDefault,
		dexFlag,
		defaultReturnAmountPos,
	)
	if err != nil {
		return "", err
	}
	if int(dexFlag)%3 == 2 {
		permit2Calldata, err = concatHex(string(permit2Calldata), zeroBytes(12), string(tokenAddress))
		if err != nil {
			return "", err
		}
	}

	return concatHex(string(approvalCalldata), string(permit2Calldata))
}

func isDisabledMaxUnitApprovalToken(network int, tokenAddress resolved.Address) bool {
	tokens, ok := disabledMaxUnitApprovalTokens[network]
	if !ok {
		return false
	}
	_, ok = tokens[lowerHex(string(tokenAddress))]
	return ok
}

func buildFinalSpecialFlagCalldata(context resolved.EncodingContext) (resolved.HexBytes, error) {
	return buildExecutor0102CallData(
		context.AugustusV6Address,
		resolved.HexBytes(zeroBytes(4)),
		0,
		0,
		specialDexSendNative,
		sendEthEqualToFromAmountDontCheckBalanceAfterSwap,
		defaultReturnAmountPos,
	)
}

func isETHAddress(address resolved.Address) bool {
	return strings.EqualFold(string(address), string(resolved.NativeTokenAddress))
}

func isWETHAddress(address resolved.Address, context resolved.EncodingContext) bool {
	return strings.EqualFold(string(address), string(context.WrappedNativeTokenAddress))
}

func getWETHAddress(
	exchangeParam resolved.DexExchangeBuildParam,
	context resolved.EncodingContext,
) resolved.Address {
	if exchangeParam.WethAddress != nil {
		return *exchangeParam.WethAddress
	}
	return context.WrappedNativeTokenAddress
}

func boolValue(value *bool) bool {
	return value != nil && *value
}
