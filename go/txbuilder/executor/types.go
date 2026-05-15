package executor

const (
	functionSelectorLength = 8

	bytes28Length = 28
	bytes64Length = 64

	defaultReturnAmountPos = 255
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
