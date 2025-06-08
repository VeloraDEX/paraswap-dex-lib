import { Interface, JsonFragment } from 'ethers';
import { NULL_ADDRESS, SwapSide } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  NumberAsString,
  SimpleExchangeParam,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import BancorABI from '../../abi/Bancor.json';
import { IDexHelper } from '../../dex-helper';
import { BancorData, BancorFunctions, BancorParam } from './types';
import { BANCOR_NETWORK, BancorRegistry } from './config';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Bancor
  extends SimpleExchange
  implements IDexTxBuilder<BancorData, BancorParam>
{
  static dexKeys = ['bancor'];
  exchangeRouterInterface: Interface;

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'bancor');
    this.exchangeRouterInterface = new Interface(BancorABI as JsonFragment[]);
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: BancorData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { path } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          path: 'address[]',
        },
      },
      { path },
    );

    return {
      targetExchange: BancorRegistry[this.network],
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: BancorData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const defaultArgs = [
      data.path,
      srcAmount,
      data.minDestToken || '1',
      NULL_ADDRESS,
      '0',
    ];
    const swapMethod = BancorFunctions.convert2;
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapMethod,
      defaultArgs,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.bancorNetwork || BANCOR_NETWORK[this.network],
    );
  }

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    data: BancorData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const defaultArgs = [
      data.path,
      srcAmount,
      data.minDestToken || '1',
      NULL_ADDRESS,
      '0',
    ];
    const swapMethod = BancorFunctions.convert2;
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapMethod,
      defaultArgs,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: data.bancorNetwork || BANCOR_NETWORK[this.network],
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.exchangeRouterInterface,
              swapMethod,
            )
          : undefined,
    };
  }
}
