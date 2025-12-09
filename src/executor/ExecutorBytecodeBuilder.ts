import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../dex-helper';
import ERC20ABI from '../abi/erc20.json';
import Permit2Abi from '../abi/permit2.json';
import { ethers } from 'ethers';
import {
  Address,
  OptimalRate,
  OptimalRoute,
  OptimalSwap,
} from '@paraswap/core';
import { DepositWithdrawReturn } from '../dex/weth/types';
import { isETHAddress } from '../utils';
import {
  APPROVE_CALLDATA_DEST_TOKEN_POS,
  BYTES_28_LENGTH,
  EXECUTOR_01_02_FUNCTION_CALL_DATA_TYPES,
  EXECUTOR_03_FUNCTION_CALL_DATA_TYPES,
  DEFAULT_RETURN_AMOUNT_POS,
  WRAP_UNWRAP_FROM_AMOUNT_POS,
  ZEROS_12_BYTES,
  ZEROS_28_BYTES,
  ZEROS_4_BYTES,
  DISABLED_MAX_UNIT_APPROVAL_TOKENS,
} from './constants';
import { Executors, Flag, SpecialDex, RouteSwaps } from './types';
import { MAX_UINT, Network, PERMIT2_ADDRESS } from '../constants';
import { DexExchangeBuildParam, DexExchangeParam } from '../types';
import { BI_MAX_UINT160, BI_MAX_UINT48 } from '../bigint-constants';

const {
  utils: { hexlify, hexDataLength, hexConcat, hexZeroPad, solidityPack },
} = ethers;

const MAX_UINT48 = BI_MAX_UINT48.toString();
const MAX_UINT160 = BI_MAX_UINT160.toString();

export type SingleSwapCallDataParams<T> = {
  routes: OptimalRoute[];
  exchangeParams: DexExchangeBuildParam[];
  index: number;
  flags: { approves: Flag[]; dexes: Flag[]; wrap: Flag };
  sender: string;
  maybeWethCallData?: DepositWithdrawReturn;
} & T;

export type DexCallDataParams<T> = {
  routes: OptimalRoute[];
  routeIndex: number;
  swapIndex: number;
  swapExchangeIndex: number;
  exchangeParams: DexExchangeBuildParam[];
  exchangeParamIndex: number;
  isLastSwap: boolean;
  flag: Flag;
} & T;

export abstract class ExecutorBytecodeBuilder<S = {}, D = {}> {
  type!: Executors;
  erc20Interface: Interface;
  permit2Interface: Interface;

  constructor(protected dexHelper: IDexHelper) {
    this.erc20Interface = new Interface(ERC20ABI);
    this.permit2Interface = new Interface(Permit2Abi);
  }

  protected buildSimpleSwapFlags(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParamIndex: number,
    maybeWethCallData?: DepositWithdrawReturn,
  ): {
    dexFlag: Flag;
    approveFlag: Flag;
  } {
    return {
      dexFlag:
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP,
      approveFlag: 0,
    };
  }

  protected buildMultiMegaSwapFlags(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeBuildParam[],
    routeIndex: number,
    swapIndex: number,
    swapExchangeIndex: number,
    exchangeParamIndex: number,
    maybeWethCallData?: DepositWithdrawReturn,
  ): {
    dexFlag: Flag;
    approveFlag: Flag;
  } {
    return {
      dexFlag:
        Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP,
      approveFlag: 0,
    };
  }

  public abstract buildByteCode(
    priceRoute: OptimalRate,
    routes: RouteSwaps[],
    exchangeParams: DexExchangeBuildParam[],
    sender: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string;

  public abstract getAddress(): string;

  protected buildSingleSwapCallData(
    params: SingleSwapCallDataParams<S>,
  ): string {
    return '0x';
  }

  protected buildDexCallData(params: DexCallDataParams<D>): string {
    return '0x';
  }

  protected buildApproveCallData(
    spender: string,
    tokenAddr: Address,
    flag: Flag,
    permit2 = false,
    amount = MAX_UINT,
  ): string {
    if (permit2) {
      return this.buildPermit2CallData(spender, tokenAddr, flag);
    }

    let approveCalldata = this.erc20Interface.encodeFunctionData('approve', [
      spender,
      amount,
    ]);

    // as approval given only for MAX_UNIT or 0, no need to use insertFromAmount flag
    const checkSrcTokenBalance = flag % 3 === 2;

    if (checkSrcTokenBalance) {
      approveCalldata = hexConcat([approveCalldata, ZEROS_12_BYTES, tokenAddr]);
    }

    let approvalCalldata = this.buildCallData(
      tokenAddr,
      approveCalldata,
      0,
      APPROVE_CALLDATA_DEST_TOKEN_POS,
      SpecialDex.DEFAULT,
      flag,
    );

    // add additional approval 0 for special cases
    if (
      amount !== '0' &&
      DISABLED_MAX_UNIT_APPROVAL_TOKENS?.[
        this.dexHelper.config.data.network as Network
      ]?.includes(tokenAddr)
    ) {
      approvalCalldata = hexConcat([
        this.buildApproveCallData(
          spender,
          tokenAddr,
          Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP,
          false,
          '0',
        ),
        approvalCalldata,
      ]);
    }

    return approvalCalldata;
  }

  protected buildPermit2CallData(
    spender: string,
    tokenAddr: Address,
    flag: Flag,
  ): string {
    // first, give approval for Permit2 on the token contract
    // (with this approval, Permit2 contract can invoke safeTransferFrom on the token)
    let approveData = this.erc20Interface.encodeFunctionData('approve', [
      PERMIT2_ADDRESS,
      MAX_UINT,
    ]);

    let approvalCalldata = this.buildCallData(
      tokenAddr,
      approveData,
      0,
      APPROVE_CALLDATA_DEST_TOKEN_POS,
      SpecialDex.DEFAULT,
      Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP,
    );

    // add additional approval 0 for special cases
    if (
      DISABLED_MAX_UNIT_APPROVAL_TOKENS?.[
        this.dexHelper.config.data.network as Network
      ]?.includes(tokenAddr)
    ) {
      let resetApprove = this.erc20Interface.encodeFunctionData('approve', [
        PERMIT2_ADDRESS,
        0,
      ]);

      approvalCalldata = hexConcat([
        this.buildCallData(
          tokenAddr,
          resetApprove,
          0,
          APPROVE_CALLDATA_DEST_TOKEN_POS,
          SpecialDex.DEFAULT,
          Flag.DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP,
        ),
        approvalCalldata,
      ]);
    }

    // second, give approval for spender on Permit2 contract
    // (with this approval, spender can interact with Permit2 on behalf of the executor)
    let permit2Data = this.permit2Interface.encodeFunctionData('approve', [
      tokenAddr,
      spender,
      MAX_UINT160,
      MAX_UINT48,
    ]);

    let permit2Calldata = this.buildCallData(
      PERMIT2_ADDRESS,
      permit2Data,
      0,
      APPROVE_CALLDATA_DEST_TOKEN_POS,
      SpecialDex.DEFAULT,
      flag,
    );

    // as approval given only for MAX_UNIT or 0, no need to use insertFromAmount flag
    const checkSrcTokenBalance = flag % 3 === 2;

    if (checkSrcTokenBalance) {
      permit2Calldata = hexConcat([permit2Calldata, ZEROS_12_BYTES, tokenAddr]);
    }

    return hexConcat([approvalCalldata, permit2Calldata]);
  }

  protected buildWrapEthCallData(
    wethAddress: string,
    depositCallData: string,
    flag: Flag,
    destTokenPos = 0,
  ): string {
    return this.buildCallData(
      wethAddress,
      depositCallData,
      WRAP_UNWRAP_FROM_AMOUNT_POS,
      destTokenPos,
      SpecialDex.DEFAULT,
      flag,
    );
  }

  protected buildUnwrapEthCallData(
    wethAddress: string,
    withdrawCallData: string,
  ): string {
    return this.buildCallData(
      wethAddress, // weth address
      withdrawCallData,
      WRAP_UNWRAP_FROM_AMOUNT_POS,
      0,
      SpecialDex.DEFAULT,
      Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP, // 7
      hexDataLength(withdrawCallData),
    );
  }

  protected buildTransferCallData(
    transferCallData: string,
    tokenAddr: Address,
  ): string {
    return this.buildCallData(
      tokenAddr,
      transferCallData,
      36,
      0,
      SpecialDex.DEFAULT,
      Flag.INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 3
      hexDataLength(transferCallData),
    );
  }

  protected buildFinalSpecialFlagCalldata(): string {
    return this.buildCallData(
      this.dexHelper.config.data.augustusV6Address!, // augustus v6 address
      ZEROS_4_BYTES,
      0,
      0,
      SpecialDex.SEND_NATIVE,
      Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP, // 9
    );
  }

  buildCallData(
    tokenAddress: string,
    calldata: string,
    fromAmountPos: number,
    destTokenPos: number,
    specialDexFlag: SpecialDex,
    flag: Flag,
    toAmountPos = 0,
    returnAmountPos = DEFAULT_RETURN_AMOUNT_POS,
  ): string {
    const builder =
      this.type !== Executors.THREE
        ? this.buildExecutor0102CallData.bind(this)
        : this.buildExecutor03CallData.bind(this);

    return builder(
      tokenAddress,
      calldata,
      fromAmountPos,
      destTokenPos,
      specialDexFlag,
      flag,
      toAmountPos,
      returnAmountPos,
    );
  }

  private buildExecutor0102CallData(
    tokenAddress: string,
    calldata: string,
    fromAmountPos: number,
    destTokenPos: number,
    specialDexFlag: SpecialDex,
    flag: Flag,
    toAmountPos = 0, // not used for Executor01 and Executor02, just to follow the same interface
    returnAmountPos = DEFAULT_RETURN_AMOUNT_POS,
  ) {
    return solidityPack(EXECUTOR_01_02_FUNCTION_CALL_DATA_TYPES, [
      tokenAddress, // token address
      hexZeroPad(hexlify(hexDataLength(calldata) + BYTES_28_LENGTH), 4), // calldata length + bytes28(0)
      hexZeroPad(hexlify(fromAmountPos), 2), // fromAmountPos
      hexZeroPad(hexlify(destTokenPos), 2), // destTokenPos
      hexZeroPad(hexlify(returnAmountPos), 1), // returnAmountPos
      hexZeroPad(hexlify(specialDexFlag), 1), // special
      hexZeroPad(hexlify(flag), 2), // flag
      ZEROS_28_BYTES, // bytes28(0)
      calldata, // calldata
    ]);
  }

  private buildExecutor03CallData(
    tokenAddress: string,
    calldata: string,
    fromAmountPos: number,
    destTokenPos: number,
    specialDexFlag: SpecialDex,
    flag: Flag,
    toAmountPos = 0,
  ) {
    return solidityPack(EXECUTOR_03_FUNCTION_CALL_DATA_TYPES, [
      tokenAddress, // token address
      hexZeroPad(hexlify(hexDataLength(calldata) + BYTES_28_LENGTH), 2), // calldata length + bytes28(0)
      hexZeroPad(hexlify(toAmountPos), 2), // toAmountPos
      hexZeroPad(hexlify(fromAmountPos), 2), // fromAmountPos
      hexZeroPad(hexlify(destTokenPos), 2), // destTokenPos
      hexZeroPad(hexlify(specialDexFlag), 2), // special
      hexZeroPad(hexlify(flag), 2), // flag
      ZEROS_28_BYTES, // bytes28(0)
      calldata, // calldata
    ]);
  }

  protected buildFlags(
    routes: OptimalRoute[],
    exchangeParams: DexExchangeBuildParam[],
    srcToken: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): { approves: Flag[]; dexes: Flag[]; wrap: Flag } {
    const isMegaSwap = routes.length > 1;
    const isMultiSwap = !isMegaSwap && routes[0].swaps.length > 1;

    const buildFlagsMethod =
      isMultiSwap || isMegaSwap
        ? this.buildMultiMegaSwapFlags.bind(this)
        : this.buildSimpleSwapFlags.bind(this);

    let exchangeParamIndex = 0;
    let flags: { dexes: Flag[]; approves: Flag[] } = {
      dexes: [],
      approves: [],
    };

    routes.map((route, routeIndex) => {
      route.swaps.map((swap, swapIndex) => {
        swap.swapExchanges.map((swapExchange, swapExchangeIndex) => {
          const { dexFlag, approveFlag } = buildFlagsMethod(
            routes,
            exchangeParams,
            routeIndex,
            swapIndex,
            swapExchangeIndex,
            exchangeParamIndex,
            maybeWethCallData,
          );

          flags.dexes.push(dexFlag);
          flags.approves.push(approveFlag);

          exchangeParamIndex++;
        });
      });
    });

    return {
      ...flags,
      wrap:
        isETHAddress(srcToken) && maybeWethCallData?.deposit
          ? Flag.SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP // 9
          : Flag.INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP, // 7
    };
  }

  addTokenAddressToCallData(callData: string, tokenAddr: Address): string {
    const isTokenInCallData = callData
      .replace('0x', '')
      .indexOf(tokenAddr.replace('0x', ''));

    if (isTokenInCallData === -1) {
      callData = hexConcat([callData, ZEROS_12_BYTES, tokenAddr]);
    }

    return callData;
  }

  getApprovalTokenAndTarget(
    swap: OptimalSwap,
    exchangeParam: DexExchangeParam,
  ): { target: string; token: Address } | null {
    if (exchangeParam.skipApproval) return null;

    const target = exchangeParam.spender || exchangeParam.targetExchange;

    if (
      !isETHAddress(swap.srcToken) &&
      !exchangeParam.transferSrcTokenBeforeSwap
    ) {
      return {
        token: swap.srcToken,
        target,
      };
    }

    if (exchangeParam.needWrapNative && isETHAddress(swap.srcToken)) {
      return {
        token: this.getWETHAddress(exchangeParam),
        target,
      };
    }

    return null;
  }

  protected getWETHAddress(exchangeParam: DexExchangeParam): string {
    const { wethAddress } = exchangeParam;
    return (
      wethAddress ||
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase()
    );
  }
}
