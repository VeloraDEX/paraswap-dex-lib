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
import { Executors, Flag, SpecialDex } from './types';
import { isETHAddress } from '../utils';
import { DepositWithdrawReturn } from '../dex/weth/types';
import {
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
};

export type Executor02DexCallDataParams = {
  swapExchange: OptimalSwapExchange<any>;
};

// ETH-dest ending steps a per-exchange unit appended (see wrapInRevertableGroup:
// a group's fallback block must end in the same state as its try block).
type GroupBranchEndState = {
  unwrapped: boolean;
  sentNative: boolean;
};

// Where an ETH-dest branch's output ends up: held as WETH on the executor,
// held as raw ETH on the executor, or already delivered to Augustus.
type EthDestOutcome = 'weth' | 'eth' | 'sent';

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
  protected buildSimpleSwapFlags(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParamIndex: number,
    maybeWethCallData?: DepositWithdrawReturn,
  ): { dexFlag: Flag; approveFlag: Flag } {
    const { srcToken, destToken } =
      priceRoute.bestRoute[routeIndex].swaps[swapIndex];
    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);

    const exchangeParam = exchangeParams[exchangeParamIndex];
    const {
      dexFuncHasRecipient,
      needWrapNative,
      needUnwrapNative,
      specialDexFlag,
      specialDexSupportsInsertFromAmount,
      swappedAmountNotPresentInExchangeData,
      sendEthButSupportsInsertFromAmount,
    } = exchangeParam;

    const isWETHSrc =
      !!needUnwrapNative && this.dexHelper.config.isWETH(srcToken);
    const isWETHDest =
      !!needUnwrapNative && this.dexHelper.config.isWETH(destToken);

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
        : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 14
    } else if (isEthDest && !needUnwrap) {
      dexFlag = forcePreventInsertFromAmount
        ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP
        : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP; // 4 or 7
    } else if (!dexFuncHasRecipient || (isEthDest && needUnwrap)) {
      dexFlag = forcePreventInsertFromAmount
        ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP
        : Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 8 or 11
    }

    // DEX operates on native ETH; we unwrap WETH to ETH before the call, then
    // check WETH src balance (should be 0) after. Some DEXes don't have a 1:1
    // ETH -> custom_ETH rate.
    if (isWETHSrc) {
      // Also insert the runtime fromAmount into the dex calldata when the dex
      // supports it: value is always the threaded amount, and split slicing can
      // drift a wei from the quoted amount — dexes that require
      // msg.value == amountIn (e.g. FluidDex) revert on the mismatch otherwise.
      dexFlag =
        sendEthButSupportsInsertFromAmount && !forcePreventInsertFromAmount
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 14
          : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 5
    } else if (isWETHDest) {
      dexFlag = forcePreventInsertFromAmount
        ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP
        : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP;
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
  protected buildMultiMegaSwapFlags(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParamIndex: number,
    maybeWethCallData?: DepositWithdrawReturn,
  ): { dexFlag: Flag; approveFlag: Flag } {
    const route = priceRoute.bestRoute[routeIndex];
    const swap = route.swaps[swapIndex];

    const exchangeParam = exchangeParams[exchangeParamIndex];

    const { srcToken, destToken } = swap;
    const applyVerticalBranching = this.doesSwapNeedToApplyVerticalBranching(
      priceRoute,
      routeIndex,
      swap,
    );

    const isHorizontalSequence = route.swaps.length > 1; // check if route is a multi-swap (horizontal sequence)
    const isFirstSwap = swapIndex === 0;
    const isLastSwap = !isFirstSwap && swapIndex === route.swaps.length - 1;

    const {
      dexFuncHasRecipient,
      needWrapNative,
      needUnwrapNative,
      specialDexFlag,
      specialDexSupportsInsertFromAmount,
      swappedAmountNotPresentInExchangeData,
      wethAddress,
      sendEthButSupportsInsertFromAmount,
    } = exchangeParam;

    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);
    const isWethDest =
      (wethAddress && destToken.toLowerCase() === wethAddress.toLowerCase()) ||
      this.dexHelper.config.isWETH(destToken);
    const isWETHSrcUnwrap =
      !!needUnwrapNative && this.dexHelper.config.isWETH(srcToken);
    const isWETHDestWrap =
      !!needUnwrapNative && this.dexHelper.config.isWETH(destToken);

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
      this.anyDexOnSwapDoesntNeedWrapNative(priceRoute, swap, exchangeParams);

    // check if current exchange is the last with needWrapNative
    const isLastExchangeWithNeedWrapNative =
      this.isLastExchangeWithNeedWrapNative(
        priceRoute,
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
          : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 14
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

    // DEX operates on native ETH; we unwrap WETH to ETH before the call, then
    // check WETH src balance (should be 0) after. Some DEXes don't have a 1:1
    // ETH -> custom_ETH rate.
    if (isWETHSrcUnwrap) {
      // Also insert the runtime fromAmount into the dex calldata when the dex
      // supports it: value is always the threaded amount, and split slicing can
      // drift a wei from the quoted amount — dexes that require
      // msg.value == amountIn (e.g. FluidDex) revert on the mismatch otherwise.
      dexFlag =
        sendEthButSupportsInsertFromAmount && !forcePreventInsertFromAmount
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP // 14
          : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 5
    } else if (isWETHDestWrap) {
      dexFlag = forcePreventInsertFromAmount
        ? Flag.DONT_INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP
        : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP;
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
      priceRoute,
      exchangeParamIndex,
      swapExchange,
      exchangeParams,
      routeIndex,
      swapIndex,
      flag,
    } = params;

    const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
    const exchangeParam = exchangeParams[exchangeParamIndex];
    let {
      exchangeData,
      specialDexFlag,
      targetExchange,
      needWrapNative,
      amountsPacked128 = false,
    } = exchangeParam;

    const routeNeedsRootUnwrapEth = this.doesRouteNeedsRootUnwrapEth(
      priceRoute,
      exchangeParams,
    );

    const needUnwrap =
      // check if current exchange is the last with needWrapNative
      this.isLastExchangeWithNeedWrapNative(
        priceRoute,
        swap,
        exchangeParams,
        exchangeParamIndex,
      ) || exchangeParam.wethAddress;

    const needUnwrapAfterLastSwapInRoute =
      needUnwrap &&
      isETHAddress(swap.destToken) &&
      this.anyDexOnSwapDoesntNeedWrapNative(priceRoute, swap, exchangeParams);

    const returnAmountPos =
      exchangeParam.returnAmountPos !== undefined &&
      !routeNeedsRootUnwrapEth &&
      !needUnwrapAfterLastSwapInRoute // prevent returnAmoutPos optimisation if route needs root unwrap eth
        ? exchangeParam.returnAmountPos
        : DEFAULT_RETURN_AMOUNT_POS;

    const applyVerticalBranching = this.doesSwapNeedToApplyVerticalBranching(
      priceRoute,
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
        fromAmountPos = this.findAmountPosWithFallback(
          exchangeData,
          swapExchange.srcAmount,
          amountsPacked128,
        );
      }
    }

    const finalFlag = amountsPacked128 ? this.applyIs128(flag) : flag;

    return this.buildCallData(
      targetExchange,
      exchangeData,
      fromAmountPos,
      destTokenPos,
      specialDexFlag || SpecialDex.DEFAULT,
      finalFlag as Flag,
      undefined,
      returnAmountPos,
    );
  }

  private addMultiSwapMetadata(
    priceRoute: OptimalRate,
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
        this.anyDexOnSwapNeedsWrapNative(priceRoute, swap, exchangeParams);
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
        ZEROS_20_BYTES, // bytes20(0)
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
    priceRoute: OptimalRate,
    routeIndex: number,
    exchangeParams: DexExchangeBuildParam[],
    swap: OptimalSwap,
    swapCallData: string,
    flag: Flag,
    isRoot = false,
  ) {
    const data = this.packVerticalBranchingData(swapCallData);

    const destTokenAddrLowered = swap.destToken.toLowerCase();
    const isEthDest = isETHAddress(destTokenAddrLowered);

    let anyDexOnSwapNeedsWrapNative = false;
    let anyDexOnSwapDoesntNeedWrapNative = false;
    let destTokenPos: number;

    if (isEthDest) {
      if (!isRoot) {
        anyDexOnSwapNeedsWrapNative = this.anyDexOnSwapNeedsWrapNative(
          priceRoute,
          swap,
          exchangeParams,
        );
        anyDexOnSwapDoesntNeedWrapNative =
          this.anyDexOnSwapDoesntNeedWrapNative(
            priceRoute,
            swap,
            exchangeParams,
          );
      } else {
        anyDexOnSwapNeedsWrapNative = priceRoute.bestRoute.some(route =>
          this.anyDexOnSwapNeedsWrapNative(
            priceRoute,
            route.swaps[route.swaps.length - 1],
            exchangeParams,
          ),
        );
        anyDexOnSwapDoesntNeedWrapNative = priceRoute.bestRoute.some(route =>
          this.anyDexOnSwapDoesntNeedWrapNative(
            priceRoute,
            route.swaps[route.swaps.length - 1],
            exchangeParams,
          ),
        );
      }
    }

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

  /**
   * Where an ETH-dest final-hop branch leaves its output. Everything outside a
   * revertable group (root unwrap/send, threading flags, sibling accounting)
   * is computed from the primary's params, so the fallback block must end in
   * the same place the try block would.
   */
  private ethDestOutcome(
    param: DexExchangeBuildParam,
    endState: GroupBranchEndState,
    // Primary raw-ETH last-hop params are built with recipient = Augustus, so
    // a recipient-capable dex delivers itself. Fallback params are always
    // built with recipient = executor (see getDexCallsParams) — their output
    // stays on the executor no matter what the dex supports.
    deliversViaRecipient: boolean,
  ): EthDestOutcome {
    if (endState.sentNative) return 'sent';
    if (param.needWrapNative) return endState.unwrapped ? 'eth' : 'weth';
    return deliversViaRecipient && param.dexFuncHasRecipient ? 'sent' : 'eth';
  }

  /**
   * Wrap an already-assembled per-exchange unit in a revertable fallback group
   * (specialDex 0xFF). The step's calldata payload is [28-byte padding]
   * [tryLen(4)][fallbackLen(4)][try-block][fallback-block]; the try-block is the
   * unit as it would have run inline, the fallback-block is the alternative's
   * unit. On-chain, Executor02 runs the try-block in a self-call and, on revert,
   * runs the fallback-block from the same input.
   *
   * Threading: when the group sits directly in a horizontal sequence
   * (insidePath = false) it must thread the running amount to the next step, so
   * it uses the vertical-branching wrapper's flag/destTokenPos semantics. When
   * it is a member of a split (insidePath = true), the vertical-branching
   * wrapper above it does the threading, so the group skips the balance check.
   */
  private wrapInRevertableGroup(
    priceRoute: OptimalRate,
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParams: DexExchangeBuildParam[],
    exchangeParamIndex: number,
    tryBlock: string,
    allowToAddWrap: boolean,
    prevBranchWasWrapped: boolean,
    insidePath: boolean,
    wrapAddedInsideTry: boolean,
    tryEndState: GroupBranchEndState,
    maybeWethCallData?: DepositWithdrawReturn,
    applyVerticalBranching?: boolean,
  ): string {
    const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
    const swapExchange = swap.swapExchanges[swapExchangeIndex];
    const fallbackParam = exchangeParams[exchangeParamIndex].fallbackParam!;

    // fallback-block: substitute the fallback param at this hop and recompute
    // flags for it. Fresh wrap maps: the fallback is an independent alternative
    // whose own wrap/approve must be encoded inside its block.
    const fallbackExchangeParams = exchangeParams.slice();
    fallbackExchangeParams[exchangeParamIndex] = fallbackParam;
    const fallbackFlags = this.buildFlags(
      priceRoute,
      fallbackExchangeParams,
      maybeWethCallData,
    );
    const fallbackEndState: GroupBranchEndState = {
      unwrapped: false,
      sentNative: false,
    };
    const fallbackWrapMap: { [key: string]: boolean } = {};
    let fallbackBlock = this.buildSingleSwapExchangeCallData(
      priceRoute,
      routeIndex,
      swapIndex,
      swapExchangeIndex,
      fallbackExchangeParams,
      fallbackFlags,
      fallbackWrapMap,
      allowToAddWrap,
      prevBranchWasWrapped,
      {},
      maybeWethCallData,
      false, // addMultiSwapMetadata — the path metadata wraps the group, not the block
      applyVerticalBranching,
      true, // disableRevertableGroup — never nest
      fallbackEndState,
    );

    // Normalize the fallback block's INPUT. When the primary's wrap lives outside
    // the try block (root/shared wrap), it persists after a try revert, so the
    // branch holds its slice as WETH — unlike a try-internal wrap, which rolls
    // back leaving raw ETH (that case the fallback unit already handles by
    // adding its own approve+deposit).
    if (
      isETHAddress(swap.srcToken) &&
      Boolean(exchangeParams[exchangeParamIndex].needWrapNative) &&
      !wrapAddedInsideTry
    ) {
      if (!fallbackParam.needWrapNative) {
        // WETH in hand, fallback consumes raw ETH: unwrap the slice first (the
        // running amount is inserted at runtime; rolls back with the block).
        fallbackBlock = hexConcat([
          this.buildUnwrapEthCallData(
            this.getWETHAddress(fallbackParam),
            this.erc20Interface.encodeFunctionData('withdraw', [
              swapExchange.srcAmount,
            ]),
          ),
          fallbackBlock,
        ]);
      } else if (fallbackParam.approveData && !fallbackParam.skipApproval) {
        // WETH in hand, fallback also consumes WETH: no deposit needed, but the
        // unit skipped its approve (it only rides with the deposit branch,
        // which the external wrap suppresses) — prepend it.
        fallbackBlock = hexConcat([
          this.buildApproveCallData(
            fallbackParam.approveData.target,
            fallbackParam.approveData.token,
            fallbackFlags.approves[exchangeParamIndex],
            fallbackParam.permit2Approval,
          ),
          fallbackBlock,
        ]);
      }
    }

    // Raw-native primary + wrap-needing fallback on a native-src hop: no wrap
    // exists on the primary path, and the fallback unit can wrongly skip its
    // own deposit — root-wrap detection runs on the SUBSTITUTED params
    // (doesRouteNeedsRootWrapEth), not the real route. If the unit didn't
    // wrap, prepend the approve+deposit.
    if (
      isETHAddress(swap.srcToken) &&
      !exchangeParams[exchangeParamIndex].needWrapNative &&
      Boolean(fallbackParam.needWrapNative) &&
      !!maybeWethCallData?.deposit &&
      !fallbackWrapMap[`${routeIndex}_${swapIndex}_${swapExchangeIndex}`]
    ) {
      const approveCallData =
        fallbackParam.approveData && !fallbackParam.skipApproval
          ? this.buildApproveCallData(
              fallbackParam.approveData.target,
              fallbackParam.approveData.token,
              fallbackFlags.approves[exchangeParamIndex],
              fallbackParam.permit2Approval,
            )
          : '0x';
      fallbackBlock = hexConcat([
        approveCallData,
        this.buildWrapEthCallData(
          this.getWETHAddress(fallbackParam),
          this.erc20Interface.encodeFunctionData('deposit'),
          Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
        ),
        fallbackBlock,
      ]);
    }

    // Normalize the fallback block's OUTPUT on an ETH-dest final hop: the
    // post-group machinery was shaped by the primary, so the fallback must
    // end where the try block would — wrap raw ETH when the try ends in WETH,
    // unwrap a WETH-holding fallback (and send if the try would have)
    // otherwise; already-delivered ('sent') is terminal.
    const isLastSwap =
      swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;
    if (isETHAddress(swap.destToken) && isLastSwap) {
      const tryOutcome = this.ethDestOutcome(
        exchangeParams[exchangeParamIndex],
        tryEndState,
        true,
      );
      const fallbackOutcome = this.ethDestOutcome(
        fallbackParam,
        fallbackEndState,
        false,
      );

      if (fallbackOutcome !== tryOutcome && fallbackOutcome !== 'sent') {
        if (tryOutcome === 'weth') {
          fallbackBlock = hexConcat([
            fallbackBlock,
            this.buildWrapEthCallData(
              this.getWETHAddress(fallbackParam),
              this.erc20Interface.encodeFunctionData('deposit'),
              Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
            ),
          ]);
        } else {
          if (fallbackOutcome === 'weth') {
            fallbackBlock = hexConcat([
              fallbackBlock,
              this.buildUnwrapEthCallData(
                this.getWETHAddress(fallbackParam),
                this.erc20Interface.encodeFunctionData('withdraw', [
                  swapExchange.destAmount,
                ]),
              ),
            ]);
          }
          if (tryOutcome === 'sent') {
            fallbackBlock = hexConcat([
              fallbackBlock,
              this.buildFinalSpecialFlagCalldata(),
            ]);
          }
        }
      }
    }

    // payload = [padding(28)][tryLen(4)][fallbackLen(4)][try][fallback]
    let payload = hexConcat([
      ZEROS_28_BYTES,
      hexZeroPad(hexlify(hexDataLength(tryBlock)), 4),
      hexZeroPad(hexlify(hexDataLength(fallbackBlock)), 4),
      tryBlock,
      fallbackBlock,
    ]);

    const flag = insidePath
      ? Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 0
      : this.buildVerticalBranchingFlag(
          priceRoute,
          swap,
          exchangeParams,
          routeIndex,
          swapIndex,
        );

    // Locate the dest token in the payload for the post-group balance check
    // (append it if absent — trailing bytes after the blocks are ignored on-chain).
    let destTokenPos = 0;
    if (flag % 3 === 2) {
      const destTokenAddr = isETHAddress(swap.destToken)
        ? this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase()
        : swap.destToken.toLowerCase();

      payload = this.addTokenAddressToCallData(payload, destTokenAddr);
      const destTokenAddrIndex = payload
        .replace('0x', '')
        .indexOf(destTokenAddr.replace('0x', ''));
      destTokenPos = destTokenAddrIndex / 2 - 40;
      if (destTokenPos < 0) destTokenPos = 0;
    }

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
        ZEROS_20_BYTES, // no call target for a group
        hexZeroPad(hexlify(hexDataLength(payload)), 4), // payload length (incl. padding)
        hexZeroPad(hexlify(0), 2), // fromAmountPos (unused by the group branch)
        hexZeroPad(hexlify(destTokenPos), 2), // destTokenPos
        hexZeroPad(hexlify(0), 1), // returnAmountPos (contract forces 0xFF)
        hexZeroPad(hexlify(SpecialDex.REVERTABLE_FALLBACK_GROUP), 1), // 0xFF
        hexZeroPad(hexlify(flag), 2), // flag (balance-check threading)
        payload,
      ],
    );
  }

  private buildSingleSwapExchangeCallData(
    priceRoute: OptimalRate,
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParams: DexExchangeBuildParam[],
    flags: { approves: Flag[]; dexes: Flag[]; wrap: Flag },
    addedWrapToSwapExchangeMap: { [key: string]: boolean },
    allowToAddWrap = true,
    prevBranchWasWrapped = false,
    unwrapToSwapMap: { [key: string]: boolean },
    maybeWethCallData?: DepositWithdrawReturn,
    addMultiSwapMetadata?: boolean,
    applyVerticalBranching?: boolean,
    disableRevertableGroup = false,
    endStateOut?: GroupBranchEndState,
  ): string {
    const isSimpleSwap =
      priceRoute.bestRoute.length === 1 &&
      priceRoute.bestRoute[0].swaps.length === 1;
    let swapExchangeCallData = '';
    const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
    const swapExchange = swap.swapExchanges[swapExchangeIndex];
    // What this unit appends for ETH-dest endings — a revertable group's
    // fallback block must end in the same state as its try block, so both
    // sides report what they did (see wrapInRevertableGroup).
    const endState: GroupBranchEndState = {
      unwrapped: false,
      sentNative: false,
    };

    let exchangeParamIndex = 0;
    let tempExchangeParamIndex = 0;

    priceRoute.bestRoute.map(route =>
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
      priceRoute,
      routeIndex,
      swapIndex,
      swapExchangeIndex,
      exchangeParams,
      exchangeParamIndex,
      isLastSwap: false,
      flag: flags.dexes[exchangeParamIndex],
      swapExchange,
    });

    const isWETHSrcUnwrap =
      !!curExchangeParam.needUnwrapNative &&
      this.dexHelper.config.isWETH(swap.srcToken);
    const isWETHDestWrap =
      !!curExchangeParam.needUnwrapNative &&
      this.dexHelper.config.isWETH(swap.destToken);

    if (isWETHSrcUnwrap) {
      const withdrawCallData = this.buildUnwrapEthCallData(
        this.getWETHAddress(curExchangeParam),
        this.erc20Interface.encodeFunctionData('withdraw', [
          swapExchange.srcAmount,
        ]),
      );
      swapExchangeCallData = hexConcat([withdrawCallData, dexCallData]);
    } else {
      swapExchangeCallData = hexConcat([dexCallData]);
    }

    if (isWETHDestWrap) {
      const depositCallData = this.buildWrapEthCallData(
        this.getWETHAddress(curExchangeParam),
        this.erc20Interface.encodeFunctionData('deposit'),
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
      );
      swapExchangeCallData = hexConcat([swapExchangeCallData, depositCallData]);
    }

    const isLastSwap =
      swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;
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
          const prevSwap =
            priceRoute.bestRoute[routeIndex].swaps[swapIndex - 1];
          const anyDexOnSwapDoesntNeedWrapNative =
            this.anyDexOnSwapDoesntNeedWrapNative(
              priceRoute,
              prevSwap,
              exchangeParams,
            );
          skipWrap = !anyDexOnSwapDoesntNeedWrapNative;
        }

        let depositCallData = '0x';
        if (
          maybeWethCallData &&
          maybeWethCallData.deposit &&
          !this.doesRouteNeedsRootWrapEth(priceRoute, exchangeParams) &&
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

      // unwrap after last swap
      if (
        maybeWethCallData &&
        maybeWethCallData.withdraw &&
        ((!applyVerticalBranching && isETHAddress(swap.destToken)) ||
          (applyVerticalBranching &&
            isETHAddress(swap.destToken) &&
            this.anyDexOnSwapDoesntNeedWrapNative(
              priceRoute,
              swap,
              exchangeParams,
            )))
      ) {
        let withdrawCallData = '0x';

        const customWethAddress = curExchangeParam.wethAddress;

        const needUnwrapAll =
          isSimpleSwap ||
          (isLastSwap
            ? !this.doesRouteNeedsRootUnwrapEth(priceRoute, exchangeParams)
            : this.everyDexOnSwapNeedWrapNative(
                priceRoute,
                priceRoute.bestRoute[routeIndex].swaps[swapIndex + 1],
                exchangeParams,
              ) ||
              this.everyDexOnSwapDoesntNeedWrapNative(
                priceRoute,
                priceRoute.bestRoute[routeIndex].swaps[swapIndex + 1],
                exchangeParams,
              ));

        // check if current exchange is the last with needWrapNative
        const needUnwrap =
          needUnwrapAll &&
          this.isLastExchangeWithNeedWrapNative(
            priceRoute,
            swap,
            exchangeParams,
            exchangeParamIndex,
          );

        if (customWethAddress || needUnwrap) {
          unwrapToSwapMap[swapIndex] = true;
          endState.unwrapped = true;
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
          endState.sentNative = true;
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
      const prevSwap = priceRoute.bestRoute[routeIndex].swaps[swapIndex - 1];
      let eachDexOnPrevSwapReturnsWeth: boolean = false;

      if (prevSwap && !prevBranchWasWrapped) {
        eachDexOnPrevSwapReturnsWeth = this.eachDexOnSwapNeedsWrapNative(
          priceRoute,
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
      priceRoute.destToken === swap.destToken
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
      !this.doesRouteNeedsRootUnwrapEth(priceRoute, exchangeParams)
    ) {
      endState.sentNative = true;
      const finalSpecialFlagCalldata = this.buildFinalSpecialFlagCalldata();
      swapExchangeCallData = hexConcat([
        swapExchangeCallData,
        finalSpecialFlagCalldata,
      ]);
    }

    if (endStateOut) {
      endStateOut.unwrapped = endState.unwrapped;
      endStateOut.sentNative = endState.sentNative;
    }

    const fallbackParam = curExchangeParam.fallbackParam;
    if (
      !disableRevertableGroup &&
      fallbackParam &&
      // Mixed wrap-ness on a MID-ROUTE ETH-dest hop is not normalized (raw ETH
      // as an intermediate threading token is flag-7 territory the group's
      // balance check doesn't model) — run plain. Final-hop mismatches are
      // normalized inside wrapInRevertableGroup (input and output side).
      !(
        isETHAddress(swap.destToken) &&
        !isLastSwap &&
        Boolean(curExchangeParam.needWrapNative) !==
          Boolean(fallbackParam.needWrapNative)
      )
    ) {
      swapExchangeCallData = this.wrapInRevertableGroup(
        priceRoute,
        routeIndex,
        swapIndex,
        swapExchangeIndex,
        exchangeParams,
        exchangeParamIndex,
        swapExchangeCallData,
        allowToAddWrap,
        prevBranchWasWrapped,
        !!addMultiSwapMetadata,
        // Whether the primary's wrap sits INSIDE the try block (rolls back with
        // it) or outside (root/shared — persists after a try revert).
        !!addedWrapToSwapExchangeMap[
          `${routeIndex}_${swapIndex}_${swapExchangeIndex}`
        ],
        endState,
        maybeWethCallData,
        applyVerticalBranching,
      );
    }

    if (addMultiSwapMetadata) {
      return this.addMultiSwapMetadata(
        priceRoute,
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
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    return swap.swapExchanges.every(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      priceRoute.bestRoute.map(route => {
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
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    const res = swap.swapExchanges.map(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      priceRoute.bestRoute.map(route => {
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
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
    exchangeParamIndex: number,
  ): boolean {
    const currentSwapExchangeParamsIndexes: number[] = [];

    swap.swapExchanges.forEach(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      priceRoute.bestRoute.forEach(route => {
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
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ) {
    return swap.swapExchanges.filter(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      priceRoute.bestRoute.map(route => {
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
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ) {
    return swap.swapExchanges.filter(curSe => {
      let index = 0;
      let swapExchangeIndex = 0;
      priceRoute.bestRoute.map(route => {
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
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    return swap.swapExchanges
      .map(curSe => {
        let index = 0;
        let swapExchangeIndex = 0;
        priceRoute.bestRoute.map(route => {
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
    priceRoute: OptimalRate,
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
        priceRoute.bestRoute.map(route => {
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
    priceRoute: OptimalRate,
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
        priceRoute.bestRoute.map(route => {
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

  private doesSwapNeedToApplyVerticalBranching(
    priceRoute: OptimalRate,
    routeIndex: number,
    swap: OptimalSwap,
  ): boolean {
    const isMegaSwap = priceRoute.bestRoute.length > 1;
    const isMultiSwap =
      !isMegaSwap && priceRoute.bestRoute[routeIndex].swaps.length > 1;

    return (isMultiSwap || isMegaSwap) && swap.swapExchanges.length > 1;
  }

  private buildVerticalBranchingFlag(
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
  ): Flag {
    let flag = Flag.INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 11

    const isLastSwap =
      swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;

    if (isLastSwap) {
      const isEthDest = isETHAddress(priceRoute.destToken);
      const lastSwap =
        priceRoute.bestRoute[routeIndex].swaps[
          priceRoute.bestRoute[routeIndex].swaps.length - 1
        ];
      const lastSwapExchanges = lastSwap.swapExchanges;
      const anyDexLastSwapNeedUnwrap = lastSwapExchanges
        .map(curSe => {
          let index = 0;
          let swapExchangeIndex = 0;
          priceRoute.bestRoute[routeIndex].swaps.map(curSwap =>
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
          this.anyDexOnSwapDoesntNeedWrapNative(
            priceRoute,
            swap,
            exchangeParams,
          )
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
      priceRoute,
      exchangeParams,
      routeIndex,
      swapIndex,
      flags,
      maybeWethCallData,
      wrapToSwapMap,
      unwrapToSwapMap,
      wrapToSwapExchangeMap,
      swap,
    } = params;
    const isLastSwap =
      swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;
    const isMegaSwap = priceRoute.bestRoute.length > 1;
    const isMultiSwap =
      !isMegaSwap && priceRoute.bestRoute[routeIndex].swaps.length > 1;

    const { swapExchanges } = swap;

    const applyVerticalBranching = this.doesSwapNeedToApplyVerticalBranching(
      priceRoute,
      routeIndex,
      swap,
    );

    const anyDexOnSwapDoesntNeedWrapNative =
      this.anyDexOnSwapDoesntNeedWrapNative(priceRoute, swap, exchangeParams);

    const needToAppendWrapCallData =
      isETHAddress(swap.destToken) &&
      anyDexOnSwapDoesntNeedWrapNative &&
      !isLastSwap &&
      maybeWethCallData?.deposit;

    let swapCallData = swapExchanges.reduce(
      (acc, swapExchange, swapExchangeIndex) => {
        return hexConcat([
          acc,
          this.buildSingleSwapExchangeCallData(
            priceRoute,
            routeIndex,
            swapIndex,
            swapExchangeIndex,
            exchangeParams,
            flags,
            wrapToSwapExchangeMap,
            !wrapToSwapMap[swapIndex - 1],
            wrapToSwapMap[swapIndex - 1],
            unwrapToSwapMap,
            maybeWethCallData,
            swap.swapExchanges.length > 1,
            applyVerticalBranching,
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
        priceRoute,
        routeIndex,
        exchangeParams,
        swap,
        swapCallData,
        this.buildVerticalBranchingFlag(
          priceRoute,
          swap,
          exchangeParams,
          routeIndex,
          swapIndex,
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
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
    route: OptimalRoute,
    routeIndex: number,
    flags: { approves: Flag[]; dexes: Flag[]; wrap: Flag },
    sender: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const isMegaSwap = priceRoute.bestRoute.length > 1;

    const { swaps } = route;

    const appendedWrapToSwapExchangeMap = {};
    const addedWrapToSwapMap = {};
    const unwrapToSwapMap = {};
    const callData = swaps.reduce<string>(
      (swapAcc, swap, swapIndex) =>
        hexConcat([
          swapAcc,
          this.buildSingleSwapCallData({
            priceRoute,
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
          }),
        ]),
      '0x',
    );

    const routeDoesntNeedToAddMultiSwapMetadata =
      route.swaps.length === 1 &&
      route.swaps[0].swapExchanges.length !== 1 &&
      !this.doesSwapNeedToApplyVerticalBranching(
        priceRoute,
        routeIndex,
        route.swaps[0],
      );

    if (isMegaSwap && !routeDoesntNeedToAddMultiSwapMetadata) {
      return this.addMultiSwapMetadata(
        priceRoute,
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
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
  ): boolean {
    if (!isETHAddress(priceRoute.srcToken)) {
      return false;
    }

    const res = priceRoute.bestRoute.every((route, routeIndex) => {
      const firstSwap = route.swaps[0];
      const eachDexOnSwapNeedsWrapNative = this.eachDexOnSwapNeedsWrapNative(
        priceRoute,
        firstSwap,
        exchangeParams,
      );

      return eachDexOnSwapNeedsWrapNative;
    });

    return res;
  }

  private doesRouteNeedsRootUnwrapEth(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeParamWithBooleanNeedWrapNative[],
  ): boolean {
    if (!isETHAddress(priceRoute.destToken)) {
      return false;
    }

    const res = priceRoute.bestRoute.some((route, routeIndex) => {
      const lastSwap = route.swaps[route.swaps.length - 1];
      const anyDexOnSwapNeedsWrapNative = this.anyDexOnSwapNeedsWrapNative(
        priceRoute,
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
    exchangeParams: DexExchangeBuildParam[],
    sender: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const isMegaSwap = priceRoute.bestRoute.length > 1;
    const isMultiSwap = !isMegaSwap && priceRoute.bestRoute[0].swaps.length > 1;

    const needWrapEth =
      maybeWethCallData?.deposit && isETHAddress(priceRoute.srcToken);
    const needUnwrapEth =
      maybeWethCallData?.withdraw && isETHAddress(priceRoute.destToken);
    const needSendNativeEth = isETHAddress(priceRoute.destToken);
    const routeNeedsRootWrapEth = this.doesRouteNeedsRootWrapEth(
      priceRoute,
      exchangeParams,
    );
    const routeNeedsRootUnwrapEth = this.doesRouteNeedsRootUnwrapEth(
      priceRoute,
      exchangeParams,
    );

    const flags = this.buildFlags(
      priceRoute,
      exchangeParams,
      maybeWethCallData,
    );

    let swapsCalldata = priceRoute.bestRoute.reduce<string>(
      (routeAcc, route, routeIndex) =>
        hexConcat([
          routeAcc,
          this.buildSingleRouteCallData(
            priceRoute,
            exchangeParams,
            route,
            routeIndex,
            flags,
            sender,
            maybeWethCallData,
          ),
        ]),
      '0x',
    );

    if (isMegaSwap && (needWrapEth || needUnwrapEth)) {
      const lastPriceRoute =
        priceRoute.bestRoute[priceRoute.bestRoute.length - 1];
      swapsCalldata = this.buildVerticalBranchingCallData(
        priceRoute,
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
              .filter((se, index) => {
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
      swapsCalldata = this.addMultiSwapMetadata(
        priceRoute,
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
