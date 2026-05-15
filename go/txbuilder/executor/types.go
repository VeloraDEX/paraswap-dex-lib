package executor

import "github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"

const (
	functionSelectorLength = 8

	bytes28Length = 28
	bytes64Length = 64
	bytes96Length = 96

	defaultReturnAmountPos      = 255
	wrapUnwrapFromAmountPos     = 4
	erc20TransferAmountPos      = 36
	approveCalldataDestTokenPos = 68
)

const (
	permit2Address = "0x000000000022d473030f116ddee9f6b43ac78ba3"
	maxUint        = resolved.DecimalString("115792089237316195423570985008687907853269984665640564039457584007913129639935")
	maxUint160     = resolved.DecimalString("1461501637330902918203684832716283019655932542975")
	maxUint48      = resolved.DecimalString("281474976710655")
)

var disabledMaxUnitApprovalTokens = map[int]map[string]struct{}{
	1: {
		"0xdac17f958d2ee523a2206206994597c13d831ec7": {},
		"0xd101dcc414f310268c37eeb4cd376ccfa507f571": {},
		"0x0f5d2fb29fb7d3cfee444a200298f468908cc942": {},
	},
}

const (
	swapExchange100Percentage          = 100
	notExistingExchangeParamIndex      = -1
	ethSrcTokenPosForMultiswapMetadata = "0xeeeeeeeeeeeeeeee"
)

type flag int

const (
	sendEthEqualToFromAmountPlusInsertFromAmountDontCheckBalanceAfterSwap     flag = 18
	sendEthEqualToFromAmountPlusInsertFromAmountCheckSrcTokenBalanceAfterSwap flag = 14
	insertFromAmountCheckSrcTokenBalanceAfterSwap                             flag = 11
	sendEthEqualToFromAmountDontCheckBalanceAfterSwap                         flag = 9
	dontInsertFromAmountCheckSrcTokenBalanceAfterSwap                         flag = 8
	insertFromAmountCheckEthBalanceAfterSwap                                  flag = 7
	sendEthEqualToFromAmountCheckSrcTokenBalanceAfterSwap                     flag = 5
	dontInsertFromAmountCheckEthBalanceAfterSwap                              flag = 4
	insertFromAmountDontCheckBalanceAfterSwap                                 flag = 3
	dontInsertFromAmountDontCheckBalanceAfterSwap                             flag = 0
)

type specialDex int

const (
	specialDexDefault                            specialDex = 0
	specialDexSwapOnSwaapV2Single                specialDex = 1
	specialDexSwapOnBalancerV1                   specialDex = 2
	specialDexSwapOnMakerPSM                     specialDex = 3
	specialDexSendNative                         specialDex = 4
	specialDexSwapOnBalancerV2                   specialDex = 5
	specialDexSwapOnUniswapV2Fork                specialDex = 6
	specialDexSwapOnDystopiaUniswapV2Fork        specialDex = 7
	specialDexSwapOnDystopiaUniswapV2ForkWithFee specialDex = 8
	specialDexSwapOnAugustusRFQ                  specialDex = 9
	specialDexExecuteVerticalBranching           specialDex = 10
	specialDexBuyOnSolidlyV3                     specialDex = 11
	specialDexSwapOnDexalot                      specialDex = 12
	specialDexSwapOnHashflow                     specialDex = 13
)
