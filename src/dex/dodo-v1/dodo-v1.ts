import { Interface, JsonFragment } from 'ethers';
import { SwapSide, MAX_UINT } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  SimpleExchangeParam,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import DodoV2ProxyABI from '../../abi/dodo-v2-proxy.json';
import { NumberAsString } from '@paraswap/core';
import { IDexHelper } from '../../dex-helper';
import { DodoV1Data, DodoV1Functions, DodoV1Param } from './types';
import { DODOApproveAddress, DODOV2ProxyAddress } from './config';
import { extractReturnAmountPosition } from '../../executor/utils';

export class DodoV1
  extends SimpleExchange
  implements IDexTxBuilder<DodoV1Data, DodoV1Param>
{
  static dexKeys = ['dodov1'];
  dodoV2Proxy: Interface;

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'dodov1');
    this.dodoV2Proxy = new Interface(DodoV2ProxyABI as JsonFragment[]);
  }

  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    data: DodoV1Data,
    _side: SwapSide,
  ): AdapterExchangeParam {
    const { dodoPairs, directions } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          dodoPairs: 'address[]',
          directions: 'uint256',
        },
      },
      { dodoPairs, directions },
    );

    return {
      targetExchange: DODOV2ProxyAddress[this.network],
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: DodoV1Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapFunction = DodoV1Functions.dodoSwapV1;
    const swapFunctionParams: DodoV1Param = [
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      data.dodoPairs,
      data.directions,
      data.isIncentive,
      MAX_UINT,
    ];
    const swapData = this.dodoV2Proxy.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      DODOV2ProxyAddress[this.network],
      DODOApproveAddress[this.network], // Warning
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _recipient: Address,
    data: DodoV1Data,
    _side: SwapSide,
  ): DexExchangeParam {
    const swapFunction = DodoV1Functions.dodoSwapV1;
    const swapFunctionParams: DodoV1Param = [
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      data.dodoPairs,
      data.directions,
      data.isIncentive,
      MAX_UINT,
    ];
    const swapData = this.dodoV2Proxy.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: DODOV2ProxyAddress[this.network],
      spender: DODOApproveAddress[this.network],
      returnAmountPos:
        _side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.dodoV2Proxy,
              swapFunction,
              'returnAmount',
            )
          : undefined,
    };
  }
}
