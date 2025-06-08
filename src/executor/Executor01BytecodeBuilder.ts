import {
  concat,
  dataLength,
  ethers,
  solidityPacked,
  toBeHex,
  zeroPadValue,
} from 'ethers';
import { DexExchangeBuildParam } from '../types';
import { OptimalRate } from '@paraswap/core';
import { isETHAddress } from '../utils';
import { DepositWithdrawReturn } from '../dex/weth/types';
import { Executors, Flag, SpecialDex } from './types';
import { BYTES_64_LENGTH, DEFAULT_RETURN_AMOUNT_POS } from './constants';
import {
  DexCallDataParams,
  ExecutorBytecodeBuilder,
  SingleSwapCallDataParams,
} from './ExecutorBytecodeBuilder';

export type Executor01SingleSwapCallDataParams = {};
export type Executor01DexCallDataParams = {};

/**
 * Class to build bytecode for Executor01 - simpleSwap (SINGLE_STEP) with 100% on a path and multiSwap with 100% amounts on each path (HORIZONTAL_SEQUENCE)
 */
export class Executor01BytecodeBuilder extends ExecutorBytecodeBuilder<
  Executor01SingleSwapCallDataParams,
  Executor01DexCallDataParams
> {
  type = Executors.ONE;
  /**
   * Executor01 Flags:
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
      specialDexFlag,
      specialDexSupportsInsertFromAmount,
      swappedAmountNotPresentInExchangeData,
      preSwapUnwrapCalldata,
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
        ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 9
        : Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP; // 5
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
   * Executor01 Flags:
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
  // Executor01 doesn't support mega swap routes, flags are built for multi swap routes only here
  protected buildMultiMegaSwapFlags(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParamIndex: number,
    maybeWethCallData?: DepositWithdrawReturn,
  ): { dexFlag: Flag; approveFlag: Flag } {
    // same as for Executor02 multi flags, except forceBalanceOfCheck
    const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
    const { srcToken, destToken } = swap;
    const exchangeParam = exchangeParams[exchangeParamIndex];
    const {
      dexFuncHasRecipient,
      needWrapNative,
      specialDexFlag,
      specialDexSupportsInsertFromAmount,
      swappedAmountNotPresentInExchangeData,
      sendEthButSupportsInsertFromAmount,
      preSwapUnwrapCalldata,
    } = exchangeParam;

    const isLastSwap =
      swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;
    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);

    const isSpecialDex =
      specialDexFlag !== undefined && specialDexFlag !== SpecialDex.DEFAULT;

    const forcePreventInsertFromAmount =
      swappedAmountNotPresentInExchangeData ||
      (isSpecialDex && !specialDexSupportsInsertFromAmount);

    const needUnwrap =
      needWrapNative && isEthDest && maybeWethCallData?.withdraw;

    const forceBalanceOfCheck = isLastSwap
      ? !dexFuncHasRecipient || needUnwrap
      : true;

    const needSendEth = isEthSrc && !needWrapNative;
    const needCheckEthBalance = isEthDest && !needWrapNative;

    const needCheckSrcTokenBalanceOf = needUnwrap && !isLastSwap;

    let dexFlag: Flag;
    let approveFlag =
      Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP; // 0

    if (needSendEth) {
      const preventInsertForSendEth =
        forcePreventInsertFromAmount || !sendEthButSupportsInsertFromAmount;
      dexFlag = forceBalanceOfCheck
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

  protected buildSingleSwapCallData(
    params: SingleSwapCallDataParams<Executor01SingleSwapCallDataParams>,
  ): string {
    const { priceRoute, index, exchangeParams, flags, maybeWethCallData } =
      params;

    let swapCallData = '';
    const swap = priceRoute.bestRoute[0].swaps[index];
    const curExchangeParam = exchangeParams[index];

    const dexCallData = this.buildDexCallData({
      priceRoute,
      routeIndex: 0,
      swapIndex: index,
      swapExchangeIndex: 0,
      exchangeParams,
      exchangeParamIndex: index,
      isLastSwap: index === priceRoute.bestRoute[0].swaps.length - 1,
      flag: flags.dexes[index],
    });

    if (curExchangeParam.preSwapUnwrapCalldata) {
      const withdrawCallData = this.buildUnwrapEthCallData(
        this.getWETHAddress(curExchangeParam),
        curExchangeParam.preSwapUnwrapCalldata,
      );
      swapCallData = concat([withdrawCallData, dexCallData]);
    } else {
      swapCallData = concat([dexCallData]);
    }

    if (curExchangeParam.transferSrcTokenBeforeSwap) {
      const transferCallData = this.buildTransferCallData(
        this.erc20Interface.encodeFunctionData('transfer', [
          curExchangeParam.transferSrcTokenBeforeSwap,
          swap.swapExchanges[0].srcAmount,
        ]),
        isETHAddress(swap.srcToken)
          ? this.getWETHAddress(curExchangeParam)
          : swap.srcToken.toLowerCase(),
      );

      swapCallData = concat([transferCallData, swapCallData]);
    }

    if (
      flags.dexes[index] % 4 !== 1 && // not sendEth
      (!isETHAddress(swap.srcToken) ||
        (isETHAddress(swap.srcToken) && index !== 0)) &&
      !curExchangeParam.transferSrcTokenBeforeSwap &&
      !curExchangeParam.skipApproval &&
      curExchangeParam.approveData
    ) {
      const approveCallData = this.buildApproveCallData(
        curExchangeParam.approveData.target,
        curExchangeParam.approveData.token,
        flags.approves[index],
        curExchangeParam.permit2Approval,
      );

      swapCallData = concat([approveCallData, swapCallData]);
    }

    if (curExchangeParam.needWrapNative && maybeWethCallData) {
      if (maybeWethCallData.deposit && isETHAddress(swap.srcToken)) {
        const prevExchangeParam = exchangeParams[index - 1];

        if (
          !prevExchangeParam ||
          (prevExchangeParam && !prevExchangeParam.needWrapNative)
        ) {
          let approveWethCalldata = '0x';
          if (
            curExchangeParam.approveData &&
            !curExchangeParam.transferSrcTokenBeforeSwap &&
            !curExchangeParam.skipApproval
          ) {
            approveWethCalldata = this.buildApproveCallData(
              curExchangeParam.approveData.target,
              curExchangeParam.approveData.token,
              flags.approves[index],
              curExchangeParam.permit2Approval,
            );
          }

          const depositCallData = this.buildWrapEthCallData(
            this.getWETHAddress(curExchangeParam),
            maybeWethCallData.deposit.calldata,
            Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP,
          );

          swapCallData = concat([
            approveWethCalldata,
            depositCallData,
            swapCallData,
          ]);
        }
      }

      if (maybeWethCallData.withdraw && isETHAddress(swap.destToken)) {
        const nextExchangeParam = exchangeParams[index + 1];

        if (
          !nextExchangeParam ||
          (nextExchangeParam && !nextExchangeParam.needWrapNative)
        ) {
          const withdrawCallData = this.buildUnwrapEthCallData(
            this.getWETHAddress(curExchangeParam),
            maybeWethCallData.withdraw.calldata,
          );
          swapCallData = concat([swapCallData, withdrawCallData]);
        }
      }
    }

    return swapCallData;
  }

  protected buildDexCallData(
    params: DexCallDataParams<Executor01DexCallDataParams>,
  ): string {
    const {
      priceRoute,
      exchangeParamIndex,
      exchangeParams,
      routeIndex,
      swapIndex,
      flag,
      swapExchangeIndex,
    } = params;

    const dontCheckBalanceAfterSwap = flag % 3 === 0;
    const checkDestTokenBalanceAfterSwap = flag % 3 === 2;
    const insertFromAmount = flag % 4 === 3 || flag % 4 === 2;
    const exchangeParam = exchangeParams[exchangeParamIndex];
    const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
    let { exchangeData, specialDexFlag } = exchangeParam;

    const returnAmountPos =
      exchangeParam.returnAmountPos !== undefined
        ? exchangeParam.returnAmountPos
        : DEFAULT_RETURN_AMOUNT_POS;

    let destTokenPos = 0;
    if (checkDestTokenBalanceAfterSwap && !dontCheckBalanceAfterSwap) {
      const destTokenAddr = isETHAddress(swap.destToken)
        ? this.getWETHAddress(exchangeParam)
        : swap.destToken.toLowerCase();

      exchangeData = this.addTokenAddressToCallData(
        exchangeData,
        destTokenAddr,
      );
      const destTokenAddrIndex = exchangeData
        .replace('0x', '')
        .indexOf(destTokenAddr.replace('0x', ''));
      destTokenPos = (destTokenAddrIndex - 24) / 2;
    }

    let fromAmountPos = 0;
    if (insertFromAmount) {
      if (exchangeParam.insertFromAmountPos) {
        fromAmountPos = exchangeParam.insertFromAmountPos;
      } else {
        const fromAmount = ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256'],
          [swap.swapExchanges[swapExchangeIndex].srcAmount],
        );

        const fromAmountIndex = exchangeData
          .replace('0x', '')
          .indexOf(fromAmount.replace('0x', ''));

        fromAmountPos =
          (fromAmountIndex !== -1 ? fromAmountIndex : exchangeData.length) / 2;
      }
    }

    return this.buildCallData(
      exchangeParam.targetExchange,
      exchangeData,
      fromAmountPos,
      destTokenPos,
      specialDexFlag || SpecialDex.DEFAULT,
      flag,
      undefined,
      returnAmountPos,
    );
  }

  public getAddress(): string {
    return this.dexHelper.config.data.executorsAddresses![Executors.ONE];
  }

  public buildByteCode(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
    sender: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    const flags = this.buildFlags(
      priceRoute,
      exchangeParams,
      maybeWethCallData,
    );

    let swapsCalldata = exchangeParams.reduce<string>(
      (acc, ep, index) =>
        concat([
          acc,
          this.buildSingleSwapCallData({
            priceRoute,
            exchangeParams,
            index,
            flags,
            sender,
            maybeWethCallData,
          }),
        ]),
      '0x',
    );

    if (
      !exchangeParams[exchangeParams.length - 1].dexFuncHasRecipient &&
      !isETHAddress(priceRoute.destToken)
    ) {
      const transferCallData = this.buildTransferCallData(
        this.erc20Interface.encodeFunctionData('transfer', [
          this.dexHelper.config.data.augustusV6Address,
          priceRoute.destAmount,
        ]),
        priceRoute.destToken,
      );

      swapsCalldata = concat([swapsCalldata, transferCallData]);
    }

    if (
      (maybeWethCallData?.withdraw && isETHAddress(priceRoute.destToken)) ||
      (!exchangeParams[exchangeParams.length - 1].dexFuncHasRecipient &&
        isETHAddress(priceRoute.destToken))
    ) {
      const finalSpecialFlagCalldata = this.buildFinalSpecialFlagCalldata();
      swapsCalldata = concat([swapsCalldata, finalSpecialFlagCalldata]);
    }

    return solidityPacked(
      ['bytes32', 'bytes', 'bytes'],
      [
        zeroPadValue(toBeHex(32), 32), // calldata offset
        zeroPadValue(
          toBeHex(dataLength(swapsCalldata) + BYTES_64_LENGTH), // calldata length  (64 bytes = bytes12(0) + msg.sender)
          32,
        ),
        swapsCalldata, // // calldata
      ],
    );
  }
}
