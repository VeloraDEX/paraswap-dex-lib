import { ethers } from 'ethers';
import {
  OptimalRoute,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
} from '@paraswap/core';
import {
  DexExchangeBuildParam,
  DexExchangeParamWithBooleanNeedWrapNative,
} from '../types';
import { Executors, Flag, RouteBuildSwaps, SpecialDex } from './types';
import { isETHAddress } from '../utils';
import { DepositWithdrawReturn } from '../dex/weth/types';
import {
  BuildSwapFlagsParams,
  DexCallDataParams,
  ExecutorBytecodeBuilder,
  SingleSwapCallDataParams,
} from './ExecutorBytecodeBuilder';
import {
  BYTES_64_LENGTH,
  NOT_EXISTING_EXCHANGE_PARAM_INDEX,
  ETH_SRC_TOKEN_POS_FOR_MULTISWAP_METADATA,
  SWAP_EXCHANGE_100_PERCENTAGE,
  ZEROS_20_BYTES,
  ZEROS_28_BYTES,
  ZEROS_4_BYTES,
  DEFAULT_RETURN_AMOUNT_POS,
} from './constants';

const {
  utils: { hexlify, hexDataLength, hexConcat, hexZeroPad, solidityPack },
} = ethers;

export type Executor02SingleSwapCallDataParams = {
  routeIndex: number;
  swapIndex: number;
  wrapToSwapMap: { [key: number]: boolean };
  unwrapToSwapMap: { [key: number]: boolean };
  wrapToSwapExchangeMap: { [key: string]: boolean };
  swap: OptimalSwap;
  srcToken: string;
  destToken: string;
};

export type Executor02DexCallDataParams = {
  swapExchange: OptimalSwapExchange<any>;
  destToken: string;
};

/**
 * Class to build bytecode for Executor02 - simpleSwap with N DEXs (VERTICAL_BRANCH), multiSwaps (VERTICAL_BRANCH_HORIZONTAL_SEQUENCE) and megaswaps (NESTED_VERTICAL_BRANCH_HORIZONTAL_SEQUENCE)
 */
export class Executor02BytecodeBuilder extends ExecutorBytecodeBuilder<
  Executor02SingleSwapCallDataParams,
  Executor02DexCallDataParams
> {
  type = Executors.TWO;
  /**
   * Executor02 Flags:
   * switch (flag % 4):
   * case 0: don't instert fromAmount
   * case 1: sendEth equal to fromAmount
   * case 2: sendEth equal to fromAmount + insert fromAmount
   * case 3: insert fromAmount

   * switch (flag % 3):
   * case 0: don't check balance after swap
   * case 1: check eth balance after swap
   * case 2: check destToken balance after swap
   */
  protected buildSimpleSwapFlags(params: BuildSwapFlagsParams): {
    dexFlag: Flag;
    approveFlag: Flag;
  } {
    const {
      routes,
      exchangeParams,
      routeIndex,
      swapIndex,
      exchangeParamIndex,
      maybeWethCallData,
    } = params;
    const { srcToken, destToken } = routes[routeIndex].swaps[swapIndex];
    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);

    const exchangeParam = exchangeParams[exchangeParamIndex];
    const {
      dexFuncHasRecipient,
      needWrapNative,
      specialDexFlag,
      specialDexSupportsInsertFromAmount,
      swappedAmountNotPresentInExchangeData,
      preSwapUnwrapCalldata,
      sendEthButSupportsInsertFromAmount,
    } = exchangeParam;

    const needWrap = needWrapNative && isEthSrc && maybeWethCallData?.deposit;
    const needUnwrap =
      needWrapNative && isEthDest && maybeWethCallData?.withdraw;
    const isSpecialDex =
      specialDexFlag !== undefined && specialDexFlag !== SpecialDex.DEFAULT;

    const forcePreventInsertFromAmount =
      swappedAmountNotPresentInExchangeData ||
      (isSpecialDex && !specialDexSupportsInsertFromAmount);

    let dexFlag = forcePreventInsertFromAmount
      ? Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP
      : Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 0 or 3
    let approveFlag =
      Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 0

    if (isEthSrc && !needWrap) {
      dexFlag = dexFuncHasRecipient
        ? !sendEthButSupportsInsertFromAmount
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 9
          : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 18
        : !sendEthButSupportsInsertFromAmount
        ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 5
        : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 18
    } else if (isEthDest && !needUnwrap) {
      dexFlag = forcePreventInsertFromAmount
        ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP
        : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP; // 4 or 7
    } else if (!dexFuncHasRecipient || (isEthDest && needUnwrap)) {
      dexFlag = forcePreventInsertFromAmount
        ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP
        : Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 8 or 11
    }

    // Actual srcToken is eth, because we'll unwrap weth before swap.
    // Need to check balance, some dexes don't have 1:1 ETH -> custom_ETH rate
    if (preSwapUnwrapCalldata) {
      dexFlag =
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP;
    }

    return {
      dexFlag,
      approveFlag,
    };
  }

  /**
   * Executor02 Flags:
   * switch (flag % 4):
   * case 0: don't instert fromAmount
   * case 1: sendEth equal to fromAmount
   * case 2: sendEth equal to fromAmount + insert fromAmount
   * case 3: insert fromAmount

   * switch (flag % 3):
   * case 0: don't check balance after swap
   * case 1: check eth balance after swap
   * case 2: check destToken balance after swap
   */
  protected buildMultiMegaSwapFlags(params: BuildSwapFlagsParams): {
    dexFlag: Flag;
    approveFlag: Flag;
  } {
    const {
      routes,
      exchangeParams,
      routeIndex,
      swapIndex,
      exchangeParamIndex,
      maybeWethCallData,
    } = params;
    const route = routes[routeIndex];
    const swap = route.swaps[swapIndex];

    const exchangeParam = exchangeParams[exchangeParamIndex];

    const { srcToken, destToken } = swap;
    const applyVerticalBranching = this.doesSwapNeedToBeAsVerticalBranch(
      routes,
      routeIndex,
      swap,
    );

    const isHorizontalSequence = route.swaps.length > 1; // check if route is a multi-swap (horizontal sequence)
    const isFirstSwap = swapIndex === 0;
    const isLastSwap = !isFirstSwap && swapIndex === route.swaps.length - 1;

    const {
      dexFuncHasRecipient,
      needWrapNative,
      specialDexFlag,
      specialDexSupportsInsertFromAmount,
      swappedAmountNotPresentInExchangeData,
      wethAddress,
      sendEthButSupportsInsertFromAmount,
      preSwapUnwrapCalldata,
    } = exchangeParam;

    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);
    const isWethDest =
      (wethAddress && destToken.toLowerCase() === wethAddress.toLowerCase()) ||
      this.dexHelper.config.isWETH(destToken);

    const isSpecialDex =
      specialDexFlag !== undefined && specialDexFlag !== SpecialDex.DEFAULT;

    const forcePreventInsertFromAmount =
      swappedAmountNotPresentInExchangeData ||
      (isSpecialDex && !specialDexSupportsInsertFromAmount);

    const forceBalanceOfCheck =
      (isSpecialDex &&
        isHorizontalSequence &&
        !applyVerticalBranching &&
        !isLastSwap) ||
      !dexFuncHasRecipient;

    const needUnwrap =
      needWrapNative && isEthDest && maybeWethCallData?.withdraw;

    const needSendEth = isEthSrc && !needWrapNative;
    const needCheckEthBalance = isEthDest && !needWrapNative;

    const anyDexOnSwapDoesntNeedWrapNative =
      this.anyDexOnSwapDoesntNeedWrapNative(routes, swap, exchangeParams);

    // check if current exchange is the last with needWrapNative
    const isLastExchangeWithNeedWrapNative =
      this.isLastExchangeWithNeedWrapNative(
        routes,
        swap,
        exchangeParams,
        exchangeParamIndex,
      );

    //  for the first part, basically replicates the logic from `unwrap after last swap` in buildSingleSwapExchangeCallData
    const needCheckSrcTokenBalanceOf =
      (needUnwrap &&
        (!applyVerticalBranching ||
          (applyVerticalBranching && anyDexOnSwapDoesntNeedWrapNative)) &&
        (isLastExchangeWithNeedWrapNative || exchangeParam.wethAddress)) ||
      (isHorizontalSequence && !applyVerticalBranching && !isLastSwap);

    let dexFlag: Flag;
    let approveFlag =
      Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 0

    if (needSendEth) {
      const preventInsertForSendEth =
        forcePreventInsertFromAmount || !sendEthButSupportsInsertFromAmount;
      dexFlag =
        needCheckSrcTokenBalanceOf || forceBalanceOfCheck
          ? preventInsertForSendEth
            ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 5
            : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 14
          : dexFuncHasRecipient
          ? preventInsertForSendEth
            ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 9
            : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 18
          : preventInsertForSendEth
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 5
          : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 18
    } else if (needCheckEthBalance) {
      dexFlag =
        needCheckSrcTokenBalanceOf || forceBalanceOfCheck
          ? forcePreventInsertFromAmount && dexFuncHasRecipient
            ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP // 4
            : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP // 7
          : forcePreventInsertFromAmount && dexFuncHasRecipient
          ? Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 0
          : Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 3
    } else {
      dexFlag =
        needCheckSrcTokenBalanceOf || forceBalanceOfCheck
          ? forcePreventInsertFromAmount
            ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 8
            : Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 11
          : forcePreventInsertFromAmount
          ? Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 0
          : Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 3
    }

    // Actual srcToken is eth, because we'll unwrap weth before swap.
    // Need to check balance, some dexes don't have 1:1 ETH -> custom_ETH rate
    if (preSwapUnwrapCalldata) {
      dexFlag =
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP;
    }

    return {
      dexFlag,
      approveFlag,
    };
  }

  protected buildDexCallData(
    params: DexCallDataParams<Executor02DexCallDataParams>,
  ): string {
    const {
      routes,
      exchangeParamIndex,
      swapExchange,
      exchangeParams,
      routeIndex,
      swapIndex,
      flag,
      destToken,
    } = params;

    const swap = routes[routeIndex].swaps[swapIndex];
    const exchangeParam = exchangeParams[exchangeParamIndex];
    let { exchangeData, specialDexFlag, targetExchange, needWrapNative } =
      exchangeParam;

    const routeNeedsRootUnwrapEth = this.doesRouteNeedsRootUnwrapEth(
      routes,
      exchangeParams,
      destToken,
    );

    const needUnwrap =
      // check if current exchange is the last with needWrapNative
      this.isLastExchangeWithNeedWrapNative(
        routes,
        swap,
        exchangeParams,
        exchangeParamIndex,
      ) || exchangeParam.wethAddress;

    const needUnwrapAfterLastSwapInRoute =
      needUnwrap &&
      isETHAddress(swap.destToken) &&
      this.anyDexOnSwapDoesntNeedWrapNative(routes, swap, exchangeParams);

    const returnAmountPos =
      exchangeParam.returnAmountPos !== undefined &&
      !routeNeedsRootUnwrapEth &&
      !needUnwrapAfterLastSwapInRoute // prevent returnAmoutPos optimisation if route needs root unwrap eth
        ? exchangeParam.returnAmountPos
        : DEFAULT_RETURN_AMOUNT_POS;

    const applyVerticalBranching = this.doesSwapNeedToBeAsVerticalBranch(
      routes,
      routeIndex,
      swap,
    );
    const dontCheckBalanceAfterSwap = flag % 3 === 0;
    const checkDestTokenBalanceAfterSwap = flag % 3 === 2;
    const insertFromAmount = flag % 4 === 3 || flag % 4 === 2;

    const srcTokenAddress =
      isETHAddress(swap.srcToken) && needWrapNative
        ? this.getWETHAddress(exchangeParam)
        : swap.srcToken.toLowerCase();

    const destTokenAddress =
      isETHAddress(swap.destToken) && needWrapNative
        ? this.getWETHAddress(exchangeParam)
        : swap.destToken.toLowerCase();

    exchangeData = this.addTokenAddressToCallData(
      exchangeData,
      srcTokenAddress,
    );

    if (
      applyVerticalBranching ||
      (checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap)
    ) {
      exchangeData = this.addTokenAddressToCallData(
        exchangeData,
        destTokenAddress,
      );
    }

    let destTokenPos = 0;
    if (checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap) {
      const destTokenAddrIndex = exchangeData
        .replace('0x', '')
        .indexOf(destTokenAddress.replace('0x', ''));
      destTokenPos = (destTokenAddrIndex - 24) / 2;
    }

    let fromAmountPos = 0;
    if (insertFromAmount) {
      if (exchangeParam.insertFromAmountPos) {
        fromAmountPos = exchangeParam.insertFromAmountPos;
      } else {
        const fromAmount = ethers.utils.defaultAbiCoder.encode(
          ['uint256'],
          [swapExchange.srcAmount],
        );
        const fromAmountIndex = exchangeData
          .replace('0x', '')
          .indexOf(fromAmount.replace('0x', ''));

        fromAmountPos =
          (fromAmountIndex !== -1 ? fromAmountIndex : exchangeData.length) / 2;
      }
    }

    return this.buildCallData(
      targetExchange,
      exchangeData,
      fromAmountPos,
      destTokenPos,
      specialDexFlag || SpecialDex.DEFAULT,
      flag,
      undefined,
      returnAmountPos,
    );
  }

  private wrapAsVerticalBranch(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeBuildParam[],
    callData: string,
    percentage: number,
    swap: OptimalSwap,
    exchangeParamIndex: number,
    wrapWasAddedInSwapExchange: boolean,
    addedUnwrapForDexWithNoNeedWrapNative = false,
  ) {
    let srcTokenAddress = swap.srcToken;

    let doesAnyDexOnSwapNeedsWrapNative: boolean;
    if (exchangeParamIndex > -1) {
      doesAnyDexOnSwapNeedsWrapNative =
        isETHAddress(srcTokenAddress) &&
        (exchangeParams[exchangeParamIndex].needWrapNative ||
          (!exchangeParams[exchangeParamIndex].needWrapNative &&
            addedUnwrapForDexWithNoNeedWrapNative));
    } else {
      doesAnyDexOnSwapNeedsWrapNative =
        isETHAddress(srcTokenAddress) &&
        this.anyDexOnSwapNeedsWrapNative(routes, swap, exchangeParams);
    }

    if (
      doesAnyDexOnSwapNeedsWrapNative &&
      isETHAddress(srcTokenAddress) &&
      !wrapWasAddedInSwapExchange
    ) {
      srcTokenAddress =
        exchangeParamIndex > -1
          ? this.getWETHAddress(exchangeParams[exchangeParamIndex])
          : this.dexHelper.config.data.wrappedNativeTokenAddress;
    }

    let srcTokenAddressLowered = srcTokenAddress.toLowerCase();
    let srcTokenPos: string;

    if (percentage === SWAP_EXCHANGE_100_PERCENTAGE) {
      srcTokenPos = hexZeroPad(hexlify(0), 8);
    } else if (isETHAddress(srcTokenAddressLowered)) {
      srcTokenPos = ETH_SRC_TOKEN_POS_FOR_MULTISWAP_METADATA;
    } else {
      const srcTokenAddrIndex = callData
        .replace('0x', '')
        .indexOf(srcTokenAddressLowered.replace('0x', ''));

      srcTokenPos = hexZeroPad(hexlify(srcTokenAddrIndex / 2), 8);
    }

    return solidityPack(
      ['bytes16', 'bytes8', 'bytes8', 'bytes'],
      [
        hexZeroPad(hexlify(hexDataLength(callData)), 16), // calldata size
        srcTokenPos, // srcTokenPos
        hexZeroPad(hexlify(Math.round(percentage * 100)), 8), // percentage
        callData, // swap calldata
      ],
    );
  }

  private packVerticalBranchingData(swapCallData: string): string {
    return solidityPack(
      ['bytes28', 'bytes4', 'bytes32', 'bytes32', 'bytes'],
      [
        ZEROS_28_BYTES, // empty bytes28
        ZEROS_4_BYTES, // fallback selector
        hexZeroPad(hexlify(32), 32), // calldata offset
        hexZeroPad(hexlify(hexDataLength(swapCallData)), 32), // calldata length
        swapCallData, // calldata
      ],
    );
  }

  private packVerticalBranchingCallData(
    verticalBranchingData: string,
    fromAmountPos: number,
    destTokenPos: number,
    flag: Flag,
  ): string {
    return solidityPack(
      [
        'bytes20',
        'bytes4',
        'bytes2',
        'bytes2',
        'bytes1',
        'bytes1',
        'bytes2',
        'bytes',
      ],
      [
        ZEROS_20_BYTES, // zero address. go to vertical branch, so no call is made
        hexZeroPad(hexlify(hexDataLength(verticalBranchingData)), 4), // dex calldata length
        hexZeroPad(hexlify(fromAmountPos), 2), // fromAmountPos
        hexZeroPad(hexlify(destTokenPos), 2), // destTokenPos
        hexZeroPad(hexlify(0), 1), // returnAmountPos
        hexZeroPad(hexlify(SpecialDex.EXECUTE_VERTICAL_BRANCHING), 1), // special
        hexZeroPad(hexlify(flag), 2), // flag
        verticalBranchingData, // dexes calldata
      ],
    );
  }

  private buildVerticalBranchingCallData(
    routes: OptimalRoute[],
    routeIndex: number,
    exchangeParams: DexExchangeBuildParam[],
    swap: OptimalSwap,
    swapCallData: string,
    flag: Flag,
    isRoot = false,
  ) {
    const destTokenAddrLowered = swap.destToken.toLowerCase();
    const isEthDest = isETHAddress(destTokenAddrLowered);

    let anyDexOnSwapNeedsWrapNative = false;
    let anyDexOnSwapDoesntNeedWrapNative = false;
    let destTokenPos: number;

    if (isEthDest) {
      if (!isRoot) {
        anyDexOnSwapNeedsWrapNative = this.anyDexOnSwapNeedsWrapNative(
          routes,
          swap,
          exchangeParams,
        );
        anyDexOnSwapDoesntNeedWrapNative =
          this.anyDexOnSwapDoesntNeedWrapNative(routes, swap, exchangeParams);
      } else {
        anyDexOnSwapNeedsWrapNative = routes.some(route =>
          this.anyDexOnSwapNeedsWrapNative(
            routes,
            route.swaps[route.swaps.length - 1],
            exchangeParams,
          ),
        );
        anyDexOnSwapDoesntNeedWrapNative = routes.some(route =>
          this.anyDexOnSwapDoesntNeedWrapNative(
            routes,
            route.swaps[route.swaps.length - 1],
            exchangeParams,
          ),
        );
      }
    }

    // 'bytes28', 'bytes4', 'bytes32', 'bytes32', 'bytes'
    const data = this.packVerticalBranchingData(swapCallData);

    if (
      isEthDest &&
      anyDexOnSwapDoesntNeedWrapNative &&
      !anyDexOnSwapNeedsWrapNative
    ) {
      destTokenPos = 0;
    } else {
      const destTokenAddrIndex = data
        .replace('0x', '')
        .indexOf(
          (isEthDest
            ? this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase()
            : destTokenAddrLowered.toLowerCase()
          ).replace('0x', ''),
        );

      destTokenPos = destTokenAddrIndex / 2 - 40;
    }

    const fromAmountPos = hexDataLength(data) - 64 - 28; // 64 (position), 28 (selector padding);

    return this.packVerticalBranchingCallData(
      data,
      fromAmountPos,
      destTokenPos < 0 ? 0 : destTokenPos,
      flag,
    );
  }

  private buildSingleSwapExchangeCallData(
    routes: OptimalRoute[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParams: DexExchangeBuildParam[],
    flags: { approves: Flag[]; dexes: Flag[]; wrap: Flag },
    addedWrapToSwapExchangeMap: { [key: string]: boolean },
    allowToAddWrap = true,
    prevBranchWasWrapped = false,
    unwrapToSwapMap: { [key: string]: boolean },
    srcToken: string,
    destToken: string,
    maybeWethCallData?: DepositWithdrawReturn,
    hasMultipleSwapExchanges?: boolean,
    isMultiOrMegaSwap?: boolean,
  ): string {
    const isSimpleSwap = routes.length === 1 && routes[0].swaps.length === 1;
    let swapExchangeCallData = '';
    const swap = routes[routeIndex].swaps[swapIndex];
    const swapExchange = swap.swapExchanges[swapExchangeIndex];

    let exchangeParamIndex = 0;
    let tempExchangeParamIndex = 0;

    routes.map(route =>
      route.swaps.map(curSwap => {
        curSwap.swapExchanges.map(async se => {
          if (Object.is(se, swapExchange)) {
            exchangeParamIndex = tempExchangeParamIndex;
          }
          tempExchangeParamIndex++;
        });
      }),
    );

    const curExchangeParam = exchangeParams[exchangeParamIndex];

    const dexCallData = this.buildDexCallData({
      routes,
      routeIndex,
      swapIndex,
      swapExchangeIndex,
      exchangeParams,
      exchangeParamIndex,
      isLastSwap: false,
      flag: flags.dexes[exchangeParamIndex],
      swapExchange,
      destToken,
    });

    if (curExchangeParam.preSwapUnwrapCalldata) {
      const withdrawCallData = this.buildUnwrapEthCallData(
        this.getWETHAddress(curExchangeParam),
        curExchangeParam.preSwapUnwrapCalldata,
      );
      swapExchangeCallData = hexConcat([withdrawCallData, dexCallData]);
    } else {
      swapExchangeCallData = hexConcat([dexCallData]);
    }

    const isLastSwap = swapIndex === routes[routeIndex].swaps.length - 1;
    const isLast = exchangeParamIndex === exchangeParams.length - 1;

    if (curExchangeParam.transferSrcTokenBeforeSwap) {
      const transferCallData = this.buildTransferCallData(
        this.erc20Interface.encodeFunctionData('transfer', [
          curExchangeParam.transferSrcTokenBeforeSwap,
          swapExchange.srcAmount,
        ]),
        isETHAddress(swap.srcToken)
          ? this.getWETHAddress(curExchangeParam)
          : swap.srcToken.toLowerCase(),
      );

      swapExchangeCallData = hexConcat([
        transferCallData,
        swapExchangeCallData,
      ]);
    }

    if (
      !isETHAddress(swap.srcToken) &&
      !curExchangeParam.transferSrcTokenBeforeSwap &&
      !curExchangeParam.skipApproval &&
      curExchangeParam.approveData
    ) {
      const approveCallData = this.buildApproveCallData(
        curExchangeParam.approveData.target,
        curExchangeParam.approveData.token,
        flags.approves[exchangeParamIndex],
        curExchangeParam.permit2Approval,
      );

      swapExchangeCallData = hexConcat([approveCallData, swapExchangeCallData]);
    }

    if (curExchangeParam.needWrapNative) {
      if (isETHAddress(swap.srcToken)) {
        let approveWethCalldata = '0x';
        if (
          curExchangeParam.approveData &&
          !curExchangeParam.transferSrcTokenBeforeSwap &&
          !curExchangeParam.skipApproval
        ) {
          approveWethCalldata = this.buildApproveCallData(
            curExchangeParam.approveData.target,
            curExchangeParam.approveData.token,
            flags.approves[exchangeParamIndex],
            curExchangeParam.permit2Approval,
          );
        }

        const isNotFirstSwap = swapIndex !== 0;
        let skipWrap = false;
        if (isNotFirstSwap) {
          const prevSwap = routes[routeIndex].swaps[swapIndex - 1];
          const anyDexOnSwapDoesntNeedWrapNative =
            this.anyDexOnSwapDoesntNeedWrapNative(
              routes,
              prevSwap,
              exchangeParams,
            );
          skipWrap = !anyDexOnSwapDoesntNeedWrapNative;
        }

        let depositCallData = '0x';
        if (
          maybeWethCallData &&
          maybeWethCallData.deposit &&
          !this.doesRouteNeedsRootWrapEth(routes, exchangeParams, srcToken) &&
          allowToAddWrap &&
          !addedWrapToSwapExchangeMap[
            `${routeIndex}_${swapIndex}_${swapExchangeIndex}`
          ] &&
          !skipWrap
        ) {
          depositCallData = this.buildWrapEthCallData(
            this.getWETHAddress(curExchangeParam),
            maybeWethCallData.deposit.calldata,
            Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
          );
          addedWrapToSwapExchangeMap[
            `${routeIndex}_${swapIndex}_${swapExchangeIndex}`
          ] = true;
        }

        swapExchangeCallData = hexConcat([
          approveWethCalldata,
          depositCallData,
          swapExchangeCallData,
        ]);
      }

      const needUnwrap = isMultiOrMegaSwap && hasMultipleSwapExchanges;
      // unwrap after last swap
      if (
        maybeWethCallData &&
        maybeWethCallData.withdraw &&
        ((!needUnwrap && isETHAddress(swap.destToken)) ||
          (needUnwrap &&
            isETHAddress(swap.destToken) &&
            this.anyDexOnSwapDoesntNeedWrapNative(
              routes,
              swap,
              exchangeParams,
            )))
      ) {
        let withdrawCallData = '0x';

        const customWethAddress = curExchangeParam.wethAddress;

        const needUnwrapAll =
          isSimpleSwap ||
          (isLastSwap
            ? !this.doesRouteNeedsRootUnwrapEth(
                routes,
                exchangeParams,
                destToken,
              )
            : this.everyDexOnSwapNeedWrapNative(
                routes,
                routes[routeIndex].swaps[swapIndex + 1],
                exchangeParams,
              ) ||
              this.everyDexOnSwapDoesntNeedWrapNative(
                routes,
                routes[routeIndex].swaps[swapIndex + 1],
                exchangeParams,
              ));

        // check if current exchange is the last with needWrapNative
        const needUnwrap =
          needUnwrapAll &&
          this.isLastExchangeWithNeedWrapNative(
            routes,
            swap,
            exchangeParams,
            exchangeParamIndex,
          );

        if (customWethAddress || needUnwrap) {
          unwrapToSwapMap[swapIndex] = true;
          withdrawCallData = this.buildUnwrapEthCallData(
            this.getWETHAddress(curExchangeParam),
            maybeWethCallData.withdraw.calldata,
          );
        }

        swapExchangeCallData = hexConcat([
          swapExchangeCallData,
          withdrawCallData,
        ]);

        if (isSimpleSwap && (needUnwrap || customWethAddress)) {
          const finalSpecialFlagCalldata = this.buildFinalSpecialFlagCalldata();
          swapExchangeCallData = hexConcat([
            swapExchangeCallData,
            finalSpecialFlagCalldata,
          ]);
        }
      }
    }

    let addedUnwrapForDexWithNoNeedWrapNative = false;
    if (
      isETHAddress(swap.srcToken) &&
      maybeWethCallData &&
      maybeWethCallData.withdraw &&
      !curExchangeParam.needWrapNative &&
      !unwrapToSwapMap[swapIndex - 1]
    ) {
      const prevSwap = routes[routeIndex].swaps[swapIndex - 1];
      let eachDexOnPrevSwapReturnsWeth: boolean = false;

      if (prevSwap && !prevBranchWasWrapped) {
        eachDexOnPrevSwapReturnsWeth = this.eachDexOnSwapNeedsWrapNative(
          routes,
          prevSwap,
          exchangeParams,
        );
      }

      if (prevBranchWasWrapped || eachDexOnPrevSwapReturnsWeth) {
        const withdrawCallData = this.buildUnwrapEthCallData(
          this.getWETHAddress(curExchangeParam),
          maybeWethCallData.withdraw.calldata,
        );

        swapExchangeCallData = hexConcat([
          withdrawCallData,
          swapExchangeCallData,
        ]);
        addedUnwrapForDexWithNoNeedWrapNative = true;
      }
    }

    if (
      isLastSwap &&
      !exchangeParams[exchangeParamIndex].dexFuncHasRecipient &&
      !isETHAddress(swap.destToken) &&
      destToken === swap.destToken
    ) {
      const transferCallData = this.buildTransferCallData(
        this.erc20Interface.encodeFunctionData('transfer', [
          this.dexHelper.config.data.augustusV6Address,
          swapExchange.destAmount,
        ]),
        swap.destToken,
      );

      swapExchangeCallData = hexConcat([
        swapExchangeCallData,
        transferCallData,
      ]);
    }

    if (
      !exchangeParams[exchangeParamIndex].dexFuncHasRecipient &&
      isETHAddress(swap.destToken) &&
      isLastSwap &&
      // don't need to send eth without unwrapping, handling unwrap and sendEth in the end of root branch
      !this.doesRouteNeedsRootUnwrapEth(routes, exchangeParams, destToken)
    ) {
      const finalSpecialFlagCalldata = this.buildFinalSpecialFlagCalldata();
      swapExchangeCallData = hexConcat([
        swapExchangeCallData,
        finalSpecialFlagCalldata,
      ]);
    }

    // if swap has multiple exchanges, then each exchange is executed as part of vertical branching
    if (hasMultipleSwapExchanges) {
      return this.wrapAsVerticalBranch(
        routes,
        exchangeParams,
        swapExchangeCallData,
        swapExchange.percent,
        swap,
        exchangeParamIndex,
        addedWrapToSwapExchangeMap[
          `${routeIndex}_${swapIndex}_${swapExchangeIndex}`
        ],
        addedUnwrapForDexWithNoNeedWrapNative,
      );
    }

    return swapExchangeCallData;
  }

  private appendWrapEthCallData(
    calldata: string,
    maybeWethCallData?: DepositWithdrawReturn,
    checkWethBalanceAfter = false,
  ) {
    if (maybeWethCallData?.deposit) {
      const callData = checkWethBalanceAfter
        ? this.addTokenAddressToCallData(
            maybeWethCallData.deposit.calldata,
            this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase(),
          )
        : maybeWethCallData.deposit.calldata;

      const depositCallData = this.buildWrapEthCallData(
        this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase(),
        callData,
        checkWethBalanceAfter
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 5
          : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
        checkWethBalanceAfter ? 4 : 0,
      );

      return hexConcat([calldata, depositCallData]);
    }

    return calldata;
  }

  private eachDexOnSwapNeedsWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    return swap.swapExchanges.every(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      routes.map(route => {
        route.swaps.map(curSwap =>
          curSwap.swapExchanges.map(async se => {
            if (Object.is(se, curSe)) {
              index = swapExchangeIndex;
            }
            swapExchangeIndex++;
          }),
        );
      });

      const curExchangeParam = exchangeParams[index];

      return curExchangeParam.needWrapNative && !curExchangeParam.wethAddress;
    });
  }

  private anyDexOnSwapNeedsWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    const res = swap.swapExchanges.map(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      routes.map(route => {
        route.swaps.map(curSwap => {
          return curSwap.swapExchanges.map(async se => {
            if (Object.is(se, curSe)) {
              index = swapExchangeIndex;
            }
            swapExchangeIndex++;
          });
        });
      });

      const curExchangeParam = exchangeParams[index];

      return curExchangeParam.needWrapNative && !curExchangeParam.wethAddress;
    });

    return res.includes(true);
  }

  private isLastExchangeWithNeedWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
    exchangeParamIndex: number,
  ): boolean {
    const currentSwapExchangeParamsIndexes: number[] = [];

    swap.swapExchanges.forEach(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      routes.forEach(route => {
        route.swaps.forEach(curSwap => {
          return curSwap.swapExchanges.forEach(async se => {
            if (Object.is(se, curSe)) {
              index = swapExchangeIndex;
            }
            swapExchangeIndex++;
          });
        });
      });

      currentSwapExchangeParamsIndexes.push(index);
    });

    return (
      exchangeParams.reduceRight(
        (acc, exchangeParam, index) =>
          exchangeParam.needWrapNative === true &&
          currentSwapExchangeParamsIndexes.includes(index) &&
          acc === -1
            ? index
            : acc,
        -1,
      ) === exchangeParamIndex
    );
  }

  private getSwapExchangesWhichNeedWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ) {
    return swap.swapExchanges.filter(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      routes.map(route => {
        route.swaps.map(curSwap => {
          return curSwap.swapExchanges.map(async se => {
            if (Object.is(se, curSe)) {
              index = swapExchangeIndex;
            }
            swapExchangeIndex++;
          });
        });
      });

      const curExchangeParam = exchangeParams[index];

      return curExchangeParam.needWrapNative && !curExchangeParam.wethAddress;
    });
  }

  private getSwapExchangesWhichDontNeedWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ) {
    return swap.swapExchanges.filter(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      routes.map(route => {
        route.swaps.map(curSwap => {
          return curSwap.swapExchanges.map(async se => {
            if (Object.is(se, curSe)) {
              index = swapExchangeIndex;
            }
            swapExchangeIndex++;
          });
        });
      });

      const curExchangeParam = exchangeParams[index];

      return !curExchangeParam.needWrapNative || curExchangeParam.wethAddress;
    });
  }

  private anyDexOnSwapDoesntNeedWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    return swap.swapExchanges
      .map(curSe => {
        let index = 0;
        let swapExchangeIndex = 0;
        routes.map(route => {
          route.swaps.map(curSwap =>
            curSwap.swapExchanges.map(async se => {
              if (Object.is(se, curSe)) {
                index = swapExchangeIndex;
              }
              swapExchangeIndex++;
            }),
          );
        });

        const curExchangeParam = exchangeParams[index];

        return !curExchangeParam.needWrapNative;
      })
      .includes(true);
  }

  private everyDexOnSwapNeedWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    if (!swap) {
      return false;
    }

    return swap.swapExchanges
      .map(curSe => {
        let index = 0;
        let swapExchangeIndex = 0;
        routes.map(route => {
          route.swaps.map(curSwap =>
            curSwap.swapExchanges.map(async se => {
              if (Object.is(se, curSe)) {
                index = swapExchangeIndex;
              }
              swapExchangeIndex++;
            }),
          );
        });

        const curExchangeParam = exchangeParams[index];

        return curExchangeParam.needWrapNative;
      })
      .every(t => t === true);
  }

  private everyDexOnSwapDoesntNeedWrapNative(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    if (!swap) {
      return false;
    }

    return swap.swapExchanges
      .map(curSe => {
        let index = 0;
        let swapExchangeIndex = 0;
        routes.map(route => {
          route.swaps.map(curSwap =>
            curSwap.swapExchanges.map(async se => {
              if (Object.is(se, curSe)) {
                index = swapExchangeIndex;
              }
              swapExchangeIndex++;
            }),
          );
        });

        const curExchangeParam = exchangeParams[index];

        return curExchangeParam.needWrapNative;
      })
      .every(t => t === false);
  }

  private doesSwapNeedToBeAsVerticalBranch(
    routes: OptimalRoute[],
    routeIndex: number,
    swap: OptimalSwap,
  ): boolean {
    const isMegaSwap = routes.length > 1;
    const isMultiSwap = !isMegaSwap && routes[routeIndex].swaps.length > 1;

    return (isMultiSwap || isMegaSwap) && swap.swapExchanges.length > 1;
  }

  private buildVerticalBranchingFlag(
    routes: OptimalRoute[],
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
    destToken: string,
  ): Flag {
    let flag = Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 11

    const isLastSwap = swapIndex === routes[routeIndex].swaps.length - 1;

    if (isLastSwap) {
      const isEthDest = isETHAddress(destToken);
      const lastSwap =
        routes[routeIndex].swaps[routes[routeIndex].swaps.length - 1];
      const lastSwapExchanges = lastSwap.swapExchanges;
      const anyDexLastSwapNeedUnwrap = lastSwapExchanges
        .map(curSe => {
          let index = 0;
          let swapExchangeIndex = 0;
          routes[routeIndex].swaps.map(curSwap =>
            curSwap.swapExchanges.map(async se => {
              if (Object.is(se, curSe)) {
                index = swapExchangeIndex;
              }
              swapExchangeIndex++;
            }),
          );

          const curExchangeParam = exchangeParams[index];

          return (
            curExchangeParam.needWrapNative && !curExchangeParam.wethAddress
          );
        })
        .includes(true);

      const noNeedUnwrap = isEthDest && !anyDexLastSwapNeedUnwrap;

      if (noNeedUnwrap || !isEthDest) {
        flag = Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 3
      }
    } else {
      const isEthDest = isETHAddress(swap.destToken);

      if (isEthDest) {
        if (
          this.anyDexOnSwapDoesntNeedWrapNative(routes, swap, exchangeParams)
        ) {
          flag = Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP; // 7
        }
      }
    }

    return flag;
  }

  protected buildSingleSwapCallData(
    params: SingleSwapCallDataParams<Executor02SingleSwapCallDataParams>,
  ): string {
    const {
      routes,
      exchangeParams,
      routeIndex,
      swapIndex,
      flags,
      maybeWethCallData,
      wrapToSwapMap,
      unwrapToSwapMap,
      wrapToSwapExchangeMap,
      swap,
      srcToken,
      destToken,
    } = params;
    const isLastSwap = swapIndex === routes[routeIndex].swaps.length - 1;
    const isMegaSwap = routes.length > 1;
    const isMultiSwap = !isMegaSwap && routes[routeIndex].swaps.length > 1;

    const { swapExchanges } = swap;

    const applyVerticalBranching = this.doesSwapNeedToBeAsVerticalBranch(
      routes,
      routeIndex,
      swap,
    );

    const anyDexOnSwapDoesntNeedWrapNative =
      this.anyDexOnSwapDoesntNeedWrapNative(routes, swap, exchangeParams);

    const needToAppendWrapCallData =
      isETHAddress(swap.destToken) &&
      anyDexOnSwapDoesntNeedWrapNative &&
      !isLastSwap &&
      maybeWethCallData?.deposit;

    let swapCallData = swapExchanges.reduce(
      (acc, _swapExchange, swapExchangeIndex) => {
        return hexConcat([
          acc,
          this.buildSingleSwapExchangeCallData(
            routes,
            routeIndex,
            swapIndex,
            swapExchangeIndex,
            exchangeParams,
            flags,
            wrapToSwapExchangeMap,
            !wrapToSwapMap[swapIndex - 1],
            wrapToSwapMap[swapIndex - 1],
            unwrapToSwapMap,
            srcToken,
            destToken,
            maybeWethCallData,
            swap.swapExchanges.length > 1,
            isMultiSwap || isMegaSwap,
          ),
        ]);
      },
      '0x',
    );

    if (needToAppendWrapCallData) {
      wrapToSwapMap[swapIndex] = true;
    }

    if (!isMultiSwap && !isMegaSwap) {
      return needToAppendWrapCallData
        ? this.appendWrapEthCallData(swapCallData, maybeWethCallData)
        : swapCallData;
    }

    if (applyVerticalBranching) {
      const vertBranchingCallData = this.buildVerticalBranchingCallData(
        routes,
        routeIndex,
        exchangeParams,
        swap,
        swapCallData,
        this.buildVerticalBranchingFlag(
          routes,
          swap,
          exchangeParams,
          routeIndex,
          swapIndex,
          destToken,
        ),
      );

      return needToAppendWrapCallData
        ? this.appendWrapEthCallData(
            vertBranchingCallData,
            maybeWethCallData,
            true,
          )
        : vertBranchingCallData;
    }

    return needToAppendWrapCallData
      ? this.appendWrapEthCallData(swapCallData, maybeWethCallData)
      : swapCallData;
  }

  protected buildSingleRouteCallData(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeBuildParam[],
    route: OptimalRoute,
    routeIndex: number,
    flags: { approves: Flag[]; dexes: Flag[]; wrap: Flag },
    sender: string,
    srcToken: string,
    destToken: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const isMegaSwap = routes.length > 1;

    const { swaps } = route;

    const appendedWrapToSwapExchangeMap = {};
    const addedWrapToSwapMap = {};
    const unwrapToSwapMap = {};
    const callData = swaps.reduce<string>(
      (swapAcc, swap, swapIndex) =>
        hexConcat([
          swapAcc,
          this.buildSingleSwapCallData({
            routes,
            exchangeParams,
            routeIndex,
            swapIndex,
            flags,
            sender,
            wrapToSwapExchangeMap: appendedWrapToSwapExchangeMap,
            wrapToSwapMap: addedWrapToSwapMap,
            unwrapToSwapMap,
            maybeWethCallData,
            swap,
            index: 0,
            srcToken,
            destToken,
          }),
        ]),
      '0x',
    );

    if (isMegaSwap) {
      return this.wrapAsVerticalBranch(
        routes,
        exchangeParams,
        callData,
        route.percent,
        route.swaps[0],
        NOT_EXISTING_EXCHANGE_PARAM_INDEX,
        Object.values(addedWrapToSwapMap).includes(true) ||
          Object.values(appendedWrapToSwapExchangeMap).includes(true),
      );
    }

    return callData;
  }

  private doesRouteNeedsRootWrapEth(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeBuildParam[],
    srcToken: string,
  ): boolean {
    if (!isETHAddress(srcToken)) {
      return false;
    }

    const res = routes.every(route => {
      const firstSwap = route.swaps[0];
      const eachDexOnSwapNeedsWrapNative = this.eachDexOnSwapNeedsWrapNative(
        routes,
        firstSwap,
        exchangeParams,
      );

      return eachDexOnSwapNeedsWrapNative;
    });

    return res;
  }

  private doesRouteNeedsRootUnwrapEth(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeParamWithBooleanNeedWrapNative[],
    destToken: string,
  ): boolean {
    if (!isETHAddress(destToken)) {
      return false;
    }

    const res = routes.some(route => {
      const lastSwap = route.swaps[route.swaps.length - 1];
      const anyDexOnSwapNeedsWrapNative = this.anyDexOnSwapNeedsWrapNative(
        routes,
        lastSwap,
        exchangeParams,
      );

      return anyDexOnSwapNeedsWrapNative;
    });

    return res;
  }

  public getAddress(): string {
    return this.dexHelper.config.data.executorsAddresses![Executors.TWO];
  }

  public buildByteCode(
    priceRoute: OptimalRate,
    routes: RouteBuildSwaps[],
    exchangeParams: DexExchangeBuildParam[],
    sender: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const _routes = routes.filter(r => r.type === 'single-route');

    const isMegaSwap = priceRoute.bestRoute.length > 1;
    const isMultiSwap = !isMegaSwap && priceRoute.bestRoute[0].swaps.length > 1;

    const needWrapEth =
      maybeWethCallData?.deposit && isETHAddress(priceRoute.srcToken);
    const needUnwrapEth =
      maybeWethCallData?.withdraw && isETHAddress(priceRoute.destToken);
    const needSendNativeEth = isETHAddress(priceRoute.destToken);
    const routeNeedsRootWrapEth = this.doesRouteNeedsRootWrapEth(
      priceRoute.bestRoute,
      exchangeParams,
      priceRoute.srcToken,
    );
    const routeNeedsRootUnwrapEth = this.doesRouteNeedsRootUnwrapEth(
      priceRoute.bestRoute,
      exchangeParams,
      priceRoute.destToken,
    );

    const flags = this.buildFlags(
      priceRoute.bestRoute,
      _routes,
      exchangeParams,
      priceRoute.srcToken,
      maybeWethCallData,
    );

    let swapsCalldata = priceRoute.bestRoute.reduce<string>(
      (routeAcc, route, routeIndex) =>
        hexConcat([
          routeAcc,
          this.buildSingleRouteCallData(
            priceRoute.bestRoute,
            exchangeParams,
            route,
            routeIndex,
            flags,
            sender,
            priceRoute.srcToken,
            priceRoute.destToken,
            maybeWethCallData,
          ),
        ]),
      '0x',
    );

    // hack to do wrap/unwrap before the priceRoute execution
    // first make wrap/unwrap, then execute mega swap as vertical branch
    if (isMegaSwap && (needWrapEth || needUnwrapEth)) {
      const lastPriceRoute =
        priceRoute.bestRoute[priceRoute.bestRoute.length - 1];
      swapsCalldata = this.buildVerticalBranchingCallData(
        priceRoute.bestRoute,
        priceRoute.bestRoute.length - 1,
        exchangeParams,
        lastPriceRoute.swaps[lastPriceRoute.swaps.length - 1],
        swapsCalldata,
        needWrapEth
          ? Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 0
          : Flag.DONT_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP, // 8
        true, // isRoot branch
      );
    }

    // ETH wrap
    if (needWrapEth && routeNeedsRootWrapEth) {
      let depositCallData = this.buildWrapEthCallData(
        this.dexHelper.config.data.wrappedNativeTokenAddress,
        maybeWethCallData.deposit!.calldata,
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
      );

      if (!(isMegaSwap || isMultiSwap)) {
        const swap = priceRoute.bestRoute[0].swaps[0];
        const percent = exchangeParams.every(ep => ep.needWrapNative)
          ? 100
          : swap.swapExchanges
              .filter((_se, index) => {
                return exchangeParams[index].needWrapNative;
              })
              .reduce<number>((acc, se) => {
                acc += se.percent;
                return acc;
              }, 0);

        depositCallData = solidityPack(
          ['bytes16', 'bytes16', 'bytes'],
          [
            hexZeroPad(hexlify(hexDataLength(depositCallData)), 16),
            hexZeroPad(hexlify(100 * percent), 16),
            depositCallData,
          ],
        );
      }

      swapsCalldata = hexConcat([depositCallData, swapsCalldata]);
    }

    // ETH unwrap, only for multiswaps and mega swaps
    if (
      needUnwrapEth &&
      routeNeedsRootUnwrapEth &&
      (isMultiSwap || isMegaSwap)
    ) {
      const withdrawCallData = this.buildUnwrapEthCallData(
        this.dexHelper.config.data.wrappedNativeTokenAddress,
        maybeWethCallData.withdraw!.calldata,
      );
      swapsCalldata = hexConcat([swapsCalldata, withdrawCallData]);
    }

    // Special flag (send native) calldata, only for multiswaps and mega swaps
    if (
      needSendNativeEth &&
      routeNeedsRootUnwrapEth &&
      (isMultiSwap || isMegaSwap)
    ) {
      const finalSpecialFlagCalldata = this.buildFinalSpecialFlagCalldata();
      swapsCalldata = hexConcat([swapsCalldata, finalSpecialFlagCalldata]);
    }

    if (((needWrapEth || needUnwrapEth) && isMegaSwap) || isMultiSwap) {
      swapsCalldata = this.wrapAsVerticalBranch(
        priceRoute.bestRoute,
        exchangeParams,
        swapsCalldata,
        SWAP_EXCHANGE_100_PERCENTAGE,
        priceRoute.bestRoute[0].swaps[0],
        NOT_EXISTING_EXCHANGE_PARAM_INDEX,
        false,
      );
    }

    return solidityPack(
      ['bytes32', 'bytes', 'bytes'],
      [
        hexZeroPad(hexlify(32), 32), // calldata offset
        hexZeroPad(
          hexlify(hexDataLength(swapsCalldata) + BYTES_64_LENGTH), // calldata length  (64 bytes = bytes12(0) + msg.sender)
          32,
        ),
        swapsCalldata, // calldata
      ],
    );
  }
}
