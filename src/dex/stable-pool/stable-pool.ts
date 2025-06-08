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
import StablePoolABI from '../../abi/StablePool.json';
import { IDexHelper } from '../../dex-helper';
import { StablePoolFunctions, StablePoolData, StablePoolParam } from './types';
import { extractReturnAmountPosition } from '../../executor/utils';
import { Interface } from 'ethers';

export class StablePool
  extends SimpleExchange
  implements IDexTxBuilder<StablePoolData, StablePoolParam>
{
  static dexKeys = ['nerve', 'ironv2', 'snowball', 'axial'];
  exchangeRouterInterface: Interface;
  minConversionRate = '1';

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'stablePool');
    this.exchangeRouterInterface = new Interface(StablePoolABI);
  }

  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    data: StablePoolData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { i, j, deadline } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          i: 'int128',
          j: 'int128',
          deadline: 'uint256',
        },
      },
      { i, j, deadline },
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
    data: StablePoolData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, deadline } = data;
    const swapFunctionParams: StablePoolParam = [
      i,
      j,
      srcAmount,
      this.minConversionRate,
      deadline,
    ];
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      StablePoolFunctions.swap,
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
    _destAmount: NumberAsString,
    _recipient: Address,
    data: StablePoolData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, deadline } = data;
    const swapFunctionParams: StablePoolParam = [
      i,
      j,
      srcAmount,
      this.minConversionRate,
      deadline,
    ];
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      StablePoolFunctions.swap,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.exchangeRouterInterface,
              StablePoolFunctions.swap,
            )
          : undefined,
    };
  }
}
