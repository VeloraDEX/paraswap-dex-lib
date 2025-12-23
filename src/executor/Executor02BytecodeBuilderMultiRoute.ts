import { ethers } from 'ethers';
import { OptimalRate, OptimalRoute } from '@paraswap/core';
import { DexExchangeBuildParam } from '../types';
import {
  BuildSwap,
  Executors,
  Flag,
  RouteBuildSwaps,
  SpecialDex,
} from './types';
import { isETHAddress } from '../utils';
import { DepositWithdrawReturn } from '../dex/weth/types';
import {
  BuildSwapFlagsParams,
  DexCallDataParams,
  ExecutorBytecodeBuilder,
  PriceRouteType,
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
import { Executor02DexCallDataParams } from './Executor02BytecodeBuilder';
import {
  getFirstRouteSwaps,
  getLastRouteSwaps,
  getPriceRouteType,
  isMultiRouteSwap,
} from './utils';

const {
  utils: { hexlify, hexDataLength, hexConcat, hexZeroPad, solidityPack },
} = ethers;

export type Executor02SingleSwapCallDataParams = {
  routeIndex: number;
  swapIndex: number;
  wrapToSwapMap: { [key: number]: boolean };
  unwrapToSwapMap: { [key: number]: boolean };
  wrapToSwapExchangeMap: { [key: string]: boolean };
  swap: BuildSwap;
  srcToken: string;
  destToken: string;
  swaps: BuildSwap[];
  rootUnwrapEth: boolean;
  rootWrapEth: boolean;
  isLastSwapOnTheRoute?: boolean;
};

export type MultiRouteExecutor02DexCallDataParams = {
  rootUnwrapEth: boolean;
  swap: BuildSwap;
  destToken: string;
};

// Disclaimer: Current encoding has a lot of complexity introduced to handle wraps/unwraps inside the route
// but since RouteAdvisor release, we rely only on wrapped tokens inside the route and handle wraps/unwraps on dex level
// so in theory we can simplify a lot of this logic in the future releases

/**
 * Class to build bytecode for Executor02 - simpleSwap with N DEXs (VERTICAL_BRANCH), multiSwaps (VERTICAL_BRANCH_HORIZONTAL_SEQUENCE) and megaswaps (NESTED_VERTICAL_BRANCH_HORIZONTAL_SEQUENCE)
 */
export class Executor02BytecodeBuilderMultiRoute extends ExecutorBytecodeBuilder<
  Executor02SingleSwapCallDataParams,
  MultiRouteExecutor02DexCallDataParams
> {
  type = Executors.TWO;
  /**
   * Executor02 Flags:
   * switch (flag % 4):
   * case 0: don't insert fromAmount
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
    const { maybeWethCallData, swapExchange, swap } = params;
    const { srcToken, destToken } = swap;
    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);

    const exchangeParam = swapExchange.build.dexParams;

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
      swaps,
      swap,
      swapExchange,
      maybeWethCallData,
      swapIndex,
      swapExchangeIndex,
      priceRouteType,
    } = params;

    const exchangeParam = swapExchange.build.dexParams;

    const { srcToken, destToken } = swap;
    const applyVerticalBranching = this.doesSwapNeedToBeAsVerticalBranch(
      priceRouteType,
      swap,
    );

    const isHorizontalSequence = swaps.length > 1; // check if route is a multi-swap (horizontal sequence)
    const isFirstSwap = swapIndex === 0;
    const isLastSwap = !isFirstSwap && swapIndex === swaps.length - 1;

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
      this.anyDexOnSwapDoesntNeedWrapNative(swap);

    // check if current exchange is the last with needWrapNative
    const isLastExchangeWithNeedWrapNative =
      this.isLastExchangeWithNeedWrapNative(swap, swapExchangeIndex);

    // for the first part, basically replicates the logic from `unwrap after last swap` in buildSingleSwapExchangeCallData
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
    params: DexCallDataParams<MultiRouteExecutor02DexCallDataParams>,
  ): string {
    const {
      swapExchangeIndex,
      destToken,
      priceRouteType,
      swap,
      rootUnwrapEth,
    } = params;

    const swapExchange = swap.swapExchanges[swapExchangeIndex];
    const flag = swapExchange.build.dexFlag;

    const exchangeParam = swap.swapExchanges[swapExchangeIndex].build.dexParams;

    let { exchangeData, specialDexFlag, targetExchange, needWrapNative } =
      exchangeParam;

    const routeNeedsRootUnwrapEth = this.doesRouteNeedsRootUnwrapEth(
      destToken,
      rootUnwrapEth,
    );

    const needUnwrap =
      // check if current exchange is the last with needWrapNative
      this.isLastExchangeWithNeedWrapNative(swap, swapExchangeIndex) ||
      exchangeParam.wethAddress;

    const needUnwrapAfterLastSwapInRoute =
      needUnwrap &&
      isETHAddress(swap.destToken) &&
      this.anyDexOnSwapDoesntNeedWrapNative(swap);

    const returnAmountPos =
      exchangeParam.returnAmountPos !== undefined &&
      !routeNeedsRootUnwrapEth &&
      !needUnwrapAfterLastSwapInRoute // prevent returnAmoutPos optimisation if route needs root unwrap eth
        ? exchangeParam.returnAmountPos
        : DEFAULT_RETURN_AMOUNT_POS;

    const applyVerticalBranching = this.doesSwapNeedToBeAsVerticalBranch(
      priceRouteType,
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
    callData: string,
    percentage: number,
    swap: BuildSwap,
    wrapWasAddedInSwapExchange: boolean,
    curExchangeParam: DexExchangeBuildParam | null = null,
    addedUnwrapForDexWithNoNeedWrapNative = false,
  ) {
    let srcTokenAddress = swap.srcToken;

    let doesAnyDexOnSwapNeedsWrapNative: boolean;
    // if (exchangeParamIndex > -1) { // TODO-multi: what this case is about?
    if (curExchangeParam) {
      doesAnyDexOnSwapNeedsWrapNative =
        isETHAddress(srcTokenAddress) &&
        (curExchangeParam.needWrapNative ||
          (!curExchangeParam.needWrapNative &&
            addedUnwrapForDexWithNoNeedWrapNative));
    } else {
      doesAnyDexOnSwapNeedsWrapNative =
        isETHAddress(srcTokenAddress) && this.anyDexOnSwapNeedsWrapNative(swap);
    }

    if (
      doesAnyDexOnSwapNeedsWrapNative &&
      isETHAddress(srcTokenAddress) &&
      !wrapWasAddedInSwapExchange
    ) {
      srcTokenAddress =
        // exchangeParamIndex > -1 TODO-multi
        curExchangeParam
          ? this.getWETHAddress(curExchangeParam)
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
    swap: BuildSwap,
    swapCallData: string,
    flag: Flag,
    isRoot = false,
    routes: RouteBuildSwaps[] = [],
  ) {
    const destTokenAddrLowered = swap.destToken.toLowerCase();
    const isEthDest = isETHAddress(destTokenAddrLowered);

    let anyDexOnSwapNeedsWrapNative = false;
    let anyDexOnSwapDoesntNeedWrapNative = false;
    let destTokenPos: number;

    if (isEthDest) {
      if (!isRoot) {
        anyDexOnSwapNeedsWrapNative = this.anyDexOnSwapNeedsWrapNative(swap);
        anyDexOnSwapDoesntNeedWrapNative =
          this.anyDexOnSwapDoesntNeedWrapNative(swap);
      } else {
        const lastSwaps = getLastRouteSwaps(routes);
        anyDexOnSwapNeedsWrapNative = lastSwaps.some(swap =>
          this.anyDexOnSwapNeedsWrapNative(swap),
        );
        anyDexOnSwapDoesntNeedWrapNative = lastSwaps.some(swap =>
          this.anyDexOnSwapDoesntNeedWrapNative(swap),
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

  private buildVerticalBranchingCallDataNoEthDest(
    destToken: string,
    swapCallData: string,
    flag: Flag,
  ) {
    const destTokenAddrLowered = destToken.toLowerCase();

    let destTokenPos: number;

    // 'bytes28', 'bytes4', 'bytes32', 'bytes32', 'bytes'
    const data = this.packVerticalBranchingData(swapCallData);

    const destTokenAddrIndex = data
      .replace('0x', '')
      .indexOf(destTokenAddrLowered.toLowerCase().replace('0x', ''));

    destTokenPos = destTokenAddrIndex / 2 - 40;

    const fromAmountPos = hexDataLength(data) - 64 - 28; // 64 (position), 28 (selector padding);

    return this.packVerticalBranchingCallData(
      data,
      fromAmountPos,
      destTokenPos < 0 ? 0 : destTokenPos,
      flag,
    );
  }

  private buildSingleSwapExchangeCallData(
    swaps: BuildSwap[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    addedWrapToSwapExchangeMap: { [key: string]: boolean },
    allowToAddWrap = true,
    prevBranchWasWrapped = false,
    unwrapToSwapMap: { [key: string]: boolean },
    srcToken: string,
    destToken: string,
    priceRouteType: PriceRouteType,
    rootUnwrapEth: boolean,
    rootWrapEth: boolean,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const isSimpleSwap = priceRouteType === 'simple';

    let swapExchangeCallData = '';
    const swap = swaps[swapIndex];
    const hasMultipleSwapExchanges = swap.swapExchanges.length > 1;
    const swapExchange = swap.swapExchanges[swapExchangeIndex];

    const curExchangeParam = swapExchange.build.dexParams;
    const approveFlag = swapExchange.build.approveFlag;

    const dexCallData = this.buildDexCallData({
      swap,
      priceRouteType,
      rootUnwrapEth,
      swapExchangeIndex,
      destToken,

      // TODO-multi to be removed after refactoring
      routes: [],
      routeIndex,
      swapIndex,
      exchangeParams: [],
      exchangeParamIndex: NOT_EXISTING_EXCHANGE_PARAM_INDEX,
      flag: Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP,
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

    const isLastSwap = swapIndex === swaps.length - 1;

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
        approveFlag,
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
            approveFlag,
            curExchangeParam.permit2Approval,
          );
        }

        const isNotFirstSwap = swapIndex !== 0;
        let skipWrap = false;
        if (isNotFirstSwap) {
          const prevSwap = swaps[swapIndex - 1];

          const anyDexOnSwapDoesntNeedWrapNative =
            this.anyDexOnSwapDoesntNeedWrapNative(prevSwap);
          skipWrap = !anyDexOnSwapDoesntNeedWrapNative;
        }

        let depositCallData = '0x';
        if (
          maybeWethCallData &&
          maybeWethCallData.deposit &&
          !this.doesRouteNeedsRootWrapEth(srcToken, rootWrapEth) &&
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

      const needUnwrap =
        (priceRouteType === 'multi' || priceRouteType === 'mega') &&
        hasMultipleSwapExchanges;
      // unwrap after last swap
      if (
        maybeWethCallData &&
        maybeWethCallData.withdraw &&
        ((!needUnwrap && isETHAddress(swap.destToken)) ||
          (needUnwrap &&
            isETHAddress(swap.destToken) &&
            this.anyDexOnSwapDoesntNeedWrapNative(swap)))
      ) {
        let withdrawCallData = '0x';

        const customWethAddress = curExchangeParam.wethAddress;

        const nextSwap = swaps[swapIndex + 1];
        const needUnwrapAll =
          isSimpleSwap ||
          (isLastSwap
            ? !this.doesRouteNeedsRootUnwrapEth(destToken, rootUnwrapEth)
            : this.everyDexOnSwapNeedWrapNative(nextSwap) ||
              this.everyDexOnSwapDoesntNeedWrapNative(nextSwap));

        // check if current exchange is the last with needWrapNative
        const needUnwrap =
          needUnwrapAll &&
          this.isLastExchangeWithNeedWrapNative(swap, swapExchangeIndex);

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
      const prevSwap = swaps[swapIndex - 1];
      let eachDexOnPrevSwapReturnsWeth: boolean = false;

      if (prevSwap && !prevBranchWasWrapped) {
        eachDexOnPrevSwapReturnsWeth =
          this.eachDexOnSwapNeedsWrapNative(prevSwap);
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
      !curExchangeParam.dexFuncHasRecipient &&
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
      !curExchangeParam.dexFuncHasRecipient &&
      isETHAddress(swap.destToken) &&
      isLastSwap &&
      // don't need to send eth without unwrapping, handling unwrap and sendEth in the end of root branch
      !this.doesRouteNeedsRootUnwrapEth(destToken, rootUnwrapEth)
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
        swapExchangeCallData,
        swapExchange.percent,
        swap,
        addedWrapToSwapExchangeMap[
          `${routeIndex}_${swapIndex}_${swapExchangeIndex}`
        ],
        curExchangeParam,
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

  private eachDexOnSwapNeedsWrapNative(swap: BuildSwap): boolean {
    return swap.swapExchanges.every(se => {
      return (
        se.build.dexParams.needWrapNative && !se.build.dexParams.wethAddress
      );
    });
  }

  private anyDexOnSwapNeedsWrapNative(swap: BuildSwap): boolean {
    return swap.swapExchanges
      .map(
        s => s.build.dexParams.needWrapNative && !s.build.dexParams.wethAddress,
      )
      .includes(true);
  }

  private isLastExchangeWithNeedWrapNative(
    swap: BuildSwap,
    swapExchangeIndex: number,
  ): boolean {
    return (
      swap.swapExchanges
        .map(t => t.build.dexParams.needWrapNative)
        .reduceRight(
          (acc, needWrapNative, index) =>
            needWrapNative === true && acc === -1 ? index : acc,
          -1,
        ) === swapExchangeIndex
    );
  }

  private anyDexOnSwapDoesntNeedWrapNative(swap: BuildSwap): boolean {
    return swap.swapExchanges
      .map(s => !s.build.dexParams.needWrapNative)
      .includes(true);
  }

  private everyDexOnSwapNeedWrapNative(swap: BuildSwap): boolean {
    if (!swap) {
      return false;
    }

    return swap.swapExchanges
      .map(s => s.build.dexParams.needWrapNative)
      .every(t => t === true);
  }

  private everyDexOnSwapDoesntNeedWrapNative(swap: BuildSwap): boolean {
    if (!swap) {
      return false;
    }

    return swap.swapExchanges
      .map(s => s.build.dexParams.needWrapNative)
      .every(t => t === false);
  }

  private doesSwapNeedToBeAsVerticalBranch(
    routeType: PriceRouteType,
    swap: BuildSwap,
  ): boolean {
    return (
      (routeType === 'multi' || routeType === 'mega') &&
      swap.swapExchanges.length > 1
    );
  }

  private buildVerticalBranchingFlag(
    swap: BuildSwap,
    destToken: string,
    isLastSwap: boolean,
  ): Flag {
    let flag = Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 11

    if (isLastSwap) {
      const isEthDest = isETHAddress(destToken);
      const lastSwapExchanges = swap.swapExchanges;
      const anyDexLastSwapNeedUnwrap = lastSwapExchanges
        .map(
          se =>
            se.build.dexParams.needWrapNative &&
            !se.build.dexParams.wethAddress,
        )
        .includes(true);

      const noNeedUnwrap = isEthDest && !anyDexLastSwapNeedUnwrap;

      if (noNeedUnwrap || !isEthDest) {
        flag = Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 3
      }
    } else {
      const isEthDest = isETHAddress(swap.destToken);

      if (isEthDest) {
        if (this.anyDexOnSwapDoesntNeedWrapNative(swap)) {
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
      routeIndex,
      swapIndex,
      maybeWethCallData,
      wrapToSwapMap,
      unwrapToSwapMap,
      wrapToSwapExchangeMap,
      swap,
      srcToken,
      destToken,
      priceRouteType,
      rootUnwrapEth,
      rootWrapEth,
      swaps,
      isLastSwapOnTheRoute,
    } = params;

    const { swapExchanges } = swap;

    const isLastSwap = swaps.length - 1 === swapIndex;

    const applyVerticalBranching = this.doesSwapNeedToBeAsVerticalBranch(
      priceRouteType,
      swap,
    );

    const anyDexOnSwapDoesntNeedWrapNative =
      this.anyDexOnSwapDoesntNeedWrapNative(swap);

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
            swaps,
            routeIndex,
            swapIndex,
            swapExchangeIndex,
            wrapToSwapExchangeMap,
            !wrapToSwapMap[swapIndex - 1],
            wrapToSwapMap[swapIndex - 1],
            unwrapToSwapMap,
            srcToken,
            destToken,
            priceRouteType,
            rootUnwrapEth,
            rootWrapEth,
            maybeWethCallData,
          ),
        ]);
      },
      '0x',
    );

    if (needToAppendWrapCallData) {
      wrapToSwapMap[swapIndex] = true;
    }

    if (priceRouteType === 'simple') {
      return needToAppendWrapCallData
        ? this.appendWrapEthCallData(swapCallData, maybeWethCallData)
        : swapCallData;
    }

    if (applyVerticalBranching) {
      const vertBranchingCallData = this.buildVerticalBranchingCallData(
        swap,
        swapCallData,
        this.buildVerticalBranchingFlag(
          swap,
          destToken,
          isLastSwapOnTheRoute ?? isLastSwap,
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

  protected buildRouteCallData(
    route: RouteBuildSwaps,
    routeIndex: number,
    flags: { approves: Flag[]; dexes: Flag[]; wrap: Flag },
    sender: string,
    srcToken: string,
    destToken: string,
    priceRouteType: PriceRouteType,
    rootUnwrapEth: boolean,
    rootWrapEth: boolean,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const buildSingleSwap = (
      swaps: BuildSwap[],
      swapIndex: number,
      swap: BuildSwap,
      wrapToSwapExchangeMap: { [key: string]: boolean },
      wrapToSwapMap: { [key: string]: boolean },
      unwrapToSwapMap: { [key: string]: boolean },
      isLastSwapOnTheRoute?: boolean,
    ) =>
      this.buildSingleSwapCallData({
        swaps,
        priceRouteType,
        rootUnwrapEth,
        rootWrapEth,
        routeIndex,
        swapIndex,
        wrapToSwapExchangeMap,
        wrapToSwapMap,
        unwrapToSwapMap,
        maybeWethCallData,
        swap,
        srcToken,
        destToken,
        isLastSwapOnTheRoute,

        // TODO-multi to be removed after refactoring
        sender,
        index: 0,
        flags,
        routes: [],
        exchangeParams: [],
      });

    const wrapToSwapExchangeMap = {}; // routeIndex_swapIndex_swapExchangeIndex
    const wrapToSwapMap = {}; // swapIndex
    const unwrapToSwapMap = {}; // swapIndex

    let callData = '0x';

    if (route.type === 'single-route') {
      callData = route.swaps.reduce<string>(
        (swapAcc, swap, swapIndex) =>
          hexConcat([
            swapAcc,
            buildSingleSwap(
              route.swaps,
              swapIndex,
              swap,
              wrapToSwapExchangeMap,
              wrapToSwapMap,
              unwrapToSwapMap,
            ),
          ]),
        '0x',
      );
    } else {
      route.swaps.forEach((multiRouteSwaps, routeSwapIndex) => {
        if (isMultiRouteSwap(multiRouteSwaps)) {
          let multiRoutesCalldata: string = '0x'; // TODO-multi: do we need this prefix?

          multiRouteSwaps.forEach((swaps, multiRouteIndex) => {
            const mrWrapToSwapExchangeMap = {}; // routeIndex_swapIndex_swapExchangeIndex
            const mrWrapToSwapMap = {}; // swapIndex
            const mrUnwrapToSwapMap = {}; // swapIndex

            const multiRouteSwapsCalldata = swaps.reduce<string>(
              (swapAcc, swap, swapIndex) =>
                hexConcat([
                  swapAcc,
                  buildSingleSwap(
                    swaps,
                    swapIndex,
                    swap,
                    mrWrapToSwapExchangeMap,
                    mrWrapToSwapMap,
                    mrUnwrapToSwapMap,
                  ),
                ]),
              '0x',
            );

            const multiRouteCalldata = this.wrapAsVerticalBranch(
              multiRouteSwapsCalldata,
              route.multiRoutePercents[multiRouteIndex],
              swaps[0],
              Object.values(mrWrapToSwapMap).includes(true) ||
                Object.values(mrWrapToSwapExchangeMap).includes(true),
              null,
            );

            multiRoutesCalldata = hexConcat([
              multiRoutesCalldata,
              multiRouteCalldata,
            ]);
          });

          // should be the same for all routes in multi-route
          const destToken = multiRouteSwaps[0].at(-1)!.destToken;

          const isLast = routeSwapIndex === route.swaps.length - 1;
          // TODO-multi: as ETH is not used as intermediate connector since RouteAdvisor release, trying to simplify here
          const routeCalldata = this.buildVerticalBranchingCallDataNoEthDest(
            destToken,
            multiRoutesCalldata,
            isLast
              ? Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP
              : Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP,
          );

          callData = hexConcat([callData, routeCalldata]);
        } else {
          callData = hexConcat([
            callData,
            multiRouteSwaps.reduce<string>(
              (swapAcc, swap, swapIndex) =>
                hexConcat([
                  swapAcc,
                  buildSingleSwap(
                    multiRouteSwaps,
                    swapIndex,
                    swap,
                    wrapToSwapExchangeMap,
                    wrapToSwapMap,
                    unwrapToSwapMap,
                    routeSwapIndex === route.swaps.length - 1 &&
                      swapIndex === multiRouteSwaps.length - 1,
                  ),
                ]),
              '0x',
            ),
          ]);
        }
      });
    }

    if (priceRouteType === 'mega') {
      let swap: BuildSwap;

      if (route.type === 'single-route') {
        swap = route.swaps[0];
      } else {
        // TODO-multi: as only swap.srcToken address is used (for srcToken != ETH), which is the same for multi-routes
        // safe to use first route
        const firstMultiRoute = route.swaps[0];
        if (isMultiRouteSwap(firstMultiRoute)) {
          swap = firstMultiRoute[0][0];
        } else {
          swap = firstMultiRoute[0];
        }
      }

      return this.wrapAsVerticalBranch(
        callData,
        route.percent,
        swap,
        Object.values(wrapToSwapMap).includes(true) ||
          Object.values(wrapToSwapExchangeMap).includes(true),
        null,
      );
    }

    return callData;
  }

  private doesRouteNeedsRootWrapEth(
    srcToken: string,
    rootWrapEth: boolean,
  ): boolean {
    if (!isETHAddress(srcToken)) {
      return false;
    }

    return rootWrapEth;
  }

  // (check disclaimer above)
  // this method is still used to prevent changes on the legacy encoding with wrap/unwrap
  // imho, this method has incorrect naming and overall misleading logic
  private doesRouteNeedsRootUnwrapEth(
    destToken: string,
    rootUnwrapEth: boolean,
  ): boolean {
    if (!isETHAddress(destToken)) {
      return false;
    }

    return rootUnwrapEth;
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
    const needWrapEth =
      maybeWethCallData?.deposit && isETHAddress(priceRoute.srcToken);
    const needUnwrapEth =
      maybeWethCallData?.withdraw && isETHAddress(priceRoute.destToken);
    const needSendNativeEth = isETHAddress(priceRoute.destToken);

    const rootWrapEth = !isETHAddress(priceRoute.srcToken)
      ? false
      : getFirstRouteSwaps(routes).every(swap =>
          this.eachDexOnSwapNeedsWrapNative(swap),
        );

    const rootUnwrapEth = !isETHAddress(priceRoute.destToken)
      ? false
      : getLastRouteSwaps(routes).some(swap =>
          this.anyDexOnSwapNeedsWrapNative(swap),
        );

    const priceRouteType = getPriceRouteType(priceRoute);

    const flags = this.buildFlags(
      priceRoute.bestRoute,
      routes,
      exchangeParams,
      priceRoute.srcToken,
      priceRouteType,
      maybeWethCallData,
    );

    let swapsCalldata = routes.reduce<string>(
      (routeAcc, route, routeIndex) =>
        hexConcat([
          routeAcc,
          this.buildRouteCallData(
            route,
            routeIndex,
            flags,
            sender,
            priceRoute.srcToken,
            priceRoute.destToken,
            priceRouteType,
            rootUnwrapEth,
            rootWrapEth,
            maybeWethCallData,
          ),
        ]),
      '0x',
    );

    // hack to do wrap/unwrap before the priceRoute execution
    // first make wrap/unwrap, then execute mega swap as vertical branch
    if (priceRouteType === 'mega' && (needWrapEth || needUnwrapEth)) {
      // TODO-multi: would it work? test this case
      const lastSwaps = getLastRouteSwaps(routes);
      const lastSwap = lastSwaps[lastSwaps.length - 1];

      swapsCalldata = this.buildVerticalBranchingCallData(
        lastSwap,
        swapsCalldata,
        needWrapEth
          ? Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 0
          : Flag.DONT_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP, // 8
        true, // isRoot branch
        routes,
      );
    }

    // ETH wrap
    if (needWrapEth && rootWrapEth) {
      let depositCallData = this.buildWrapEthCallData(
        this.dexHelper.config.data.wrappedNativeTokenAddress,
        maybeWethCallData.deposit!.calldata,
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
      );

      if (priceRouteType === 'simple') {
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
      rootUnwrapEth &&
      (priceRouteType === 'multi' || priceRouteType === 'mega')
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
      rootUnwrapEth &&
      (priceRouteType === 'multi' || priceRouteType === 'mega')
    ) {
      const finalSpecialFlagCalldata = this.buildFinalSpecialFlagCalldata();
      swapsCalldata = hexConcat([swapsCalldata, finalSpecialFlagCalldata]);
    }

    if (
      ((needWrapEth || needUnwrapEth) && priceRouteType === 'mega') ||
      priceRouteType === 'multi'
    ) {
      // TODO-multi: would it work? test this case
      const firstSwaps = getFirstRouteSwaps(routes);
      swapsCalldata = this.wrapAsVerticalBranch(
        swapsCalldata,
        SWAP_EXCHANGE_100_PERCENTAGE,
        firstSwaps[0],
        false,
        null,
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

  protected buildFlags(
    routes: OptimalRoute[],
    buildRoutes: RouteBuildSwaps[],
    exchangeParams: DexExchangeBuildParam[],
    srcToken: string,
    priceRouteType: PriceRouteType,
    maybeWethCallData?: DepositWithdrawReturn,
  ): { approves: Flag[]; dexes: Flag[]; wrap: Flag } {
    const buildFlagsMethod =
      priceRouteType === 'multi' || priceRouteType === 'mega'
        ? this.buildMultiMegaSwapFlags.bind(this)
        : this.buildSimpleSwapFlags.bind(this);

    let flags: { dexes: Flag[]; approves: Flag[] } = {
      dexes: [],
      approves: [],
    };

    const buildAndAssignFlags = (
      swaps: BuildSwap[],
      swap: BuildSwap,
      swapIndex: number,
    ) => {
      swap.swapExchanges.map((swapExchange, swapExchangeIndex) => {
        const { dexFlag, approveFlag } = buildFlagsMethod({
          priceRouteType,
          swaps,
          routes,
          exchangeParams,
          routeIndex: 0, // not used on Ex02MultiRoute
          swapIndex,
          swapExchangeIndex,
          exchangeParamIndex: 0, // TODO-multi: to be removed after refactoring
          maybeWethCallData,
          swap,
          swapExchange,
        });
        swapExchange.build.dexFlag = dexFlag;
        swapExchange.build.approveFlag = approveFlag;

        flags.dexes.push(dexFlag);
        flags.approves.push(approveFlag);
      });
    };

    buildRoutes.forEach(route => {
      if (route.type === 'single-route') {
        route.swaps.map((swap, swapIndex) => {
          buildAndAssignFlags(route.swaps, swap, swapIndex);
        });
      } else {
        route.swaps.forEach(routeSwaps => {
          const isMultiRoute = isMultiRouteSwap(routeSwaps);
          if (!isMultiRoute) {
            // TODO-multi: should swapIndex be the index of the current multi-route, or the total route
            routeSwaps.forEach((swap, swapIndex) => {
              buildAndAssignFlags(routeSwaps, swap, swapIndex);
            });
          } else {
            routeSwaps.forEach(swaps => {
              swaps.forEach((swap, swapIndex) => {
                buildAndAssignFlags(swaps, swap, swapIndex);
              });
            });
          }
        });
      }
    });

    return {
      ...flags,
      wrap:
        isETHAddress(srcToken) && maybeWethCallData?.deposit
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 9
          : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP, // 7
    };
  }
}
