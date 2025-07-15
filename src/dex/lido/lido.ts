import { Interface, JsonFragment } from '@ethersproject/abi';
import { NumberAsString, SwapSide } from '@paraswap/core';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  SimpleExchangeParam,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import stETHAbi from '../../abi/stETH.json';
import { NULL_ADDRESS } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { LidoData, stETHFunctions } from './types';
import { stETH } from './config';
import { WethFunctions } from '../weth/types';
import ERC20ABI from '../../abi/erc20.json';

export class Lido implements IDexTxBuilder<LidoData, any> {
  static dexKeys = ['lido'];
  stETHInterface: Interface;
  erc20Interface: Interface;

  needWrapNative = false;

  private readonly network: number;
  private readonly referralAddress: Address;
  private readonly wethAddress: Address;

  constructor(dexHelper: IDexHelper) {
    this.network = dexHelper.config.data.network;

    this.stETHInterface = new Interface(stETHAbi as JsonFragment[]);
    this.erc20Interface = new Interface(ERC20ABI);
    this.referralAddress =
      dexHelper.config.data.lidoReferralAddress ?? NULL_ADDRESS;
    this.wethAddress =
      dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: LidoData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: stETH[this.network],
      payload: '0x',
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: LidoData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = this.stETHInterface.encodeFunctionData(
      stETHFunctions.submit,
      [this.referralAddress],
    );

    return {
      callees: [stETH[this.network]],
      calldata: [swapData],
      values: [srcAmount],
      networkFee: '0',
    };
  }

  protected isWETH(tokenAddress: string) {
    return tokenAddress.toLowerCase() === this.wethAddress;
  }

  getDexParam(
    srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    _data: LidoData,
    _side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.stETHInterface.encodeFunctionData(
      stETHFunctions.submit,
      [this.referralAddress],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: stETH[this.network],
      preSwapUnwrapCalldata: this.isWETH(srcToken)
        ? this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
            srcAmount,
          ])
        : undefined,
    };
  }
}
