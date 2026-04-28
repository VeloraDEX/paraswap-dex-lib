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

export class Lido implements IDexTxBuilder<LidoData, any> {
  static dexKeys = ['lido'];
  stETHInterface: Interface;

  needWrapNative = false;

  private readonly network: number;
  private readonly referralAddress: Address;

  constructor(dexHelper: IDexHelper) {
    this.network = dexHelper.config.data.network;

    this.stETHInterface = new Interface(stETHAbi as JsonFragment[]);
    this.referralAddress =
      dexHelper.config.data.lidoReferralAddress ?? NULL_ADDRESS;
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

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
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
      needUnwrapNative: true,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: stETH[this.network],
    };
  }
}
