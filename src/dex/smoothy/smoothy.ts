import { Interface } from '@ethersproject/abi';
import { SwapSide } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  NumberAsString,
  SimpleExchangeParam,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import SmoothyABI from '../../abi/Smoothy.json';
import { IDexHelper } from '../../dex-helper';
import { SmoothyData, SmoothyFunctions, SmoothyParam } from './types';

export class Smoothy
  extends SimpleExchange
  implements IDexTxBuilder<SmoothyData, SmoothyParam>
{
  static dexKeys = ['smoothy'];
  exchangeRouterInterface: Interface;
  minConversionRate = '1';

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'smoothy');
    this.exchangeRouterInterface = new Interface(SmoothyABI);
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SmoothyData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { i, j } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          i: 'int128',
          j: 'int128',
        },
      },
      { i, j },
    );
    return {
      targetExchange: data.exchange,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SmoothyData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j } = data;
    const swapFunctionParams: SmoothyParam = [i, j, srcAmount, destAmount];
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      SmoothyFunctions.swap,
      swapFunctionParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
    );
  }

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _recipient: Address,
    data: SmoothyData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j } = data;
    const swapFunctionParams: SmoothyParam = [i, j, srcAmount, destAmount];
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      SmoothyFunctions.swap,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos: undefined,
    };
  }
}
