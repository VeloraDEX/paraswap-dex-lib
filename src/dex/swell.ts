import { Interface, JsonFragment } from '@ethersproject/abi';
import { NumberAsString, SwapSide } from '@paraswap/core';
import { AdapterExchangeParam, Address, SimpleExchangeParam } from '../types';
import { IDexTxBuilder } from './idex';
import SWETH_ABI from '../abi/swETH.json';
import { NULL_ADDRESS } from '../constants';
import Web3 from 'web3';
import { IDexHelper } from '../dex-helper';

export const swETH: any = {
  1: '0xf951E335afb289353dc249e82926178EaC7DEd78',
};

export enum swETHFunctions {
  deposit = 'deposit',
}

export type SwellData = {};

export class Swell implements IDexTxBuilder<SwellData, any> {
  static dexKeys = ['swell'];
  swETHInterface: Interface;

  needWrapNative = false;

  private network: number;

  constructor(dexHelper: IDexHelper) {
    this.network = dexHelper.config.data.network;

    this.swETHInterface = new Interface(SWETH_ABI as JsonFragment[]);
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: SwellData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: swETH[this.network],
      payload: '0x',
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: SwellData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = this.swETHInterface.encodeFunctionData(
      swETHFunctions.deposit,
      [NULL_ADDRESS],
    );

    return {
      callees: [swETH[this.network]],
      calldata: [swapData],
      values: [srcAmount],
      networkFee: '0',
    };
  }
}
