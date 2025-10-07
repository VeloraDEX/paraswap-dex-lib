import { Interface, JsonFragment } from '@ethersproject/abi';
import { SwapSide, MAX_UINT, Network } from '../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  SimpleExchangeParam,
} from '../types';
import { IDexTxBuilder } from './idex';
import { SimpleExchange } from './simple-exchange';
import DodoV2ProxyABI from '../abi/dodo-v2-proxy.json';
import { NumberAsString } from '@paraswap/core';
import { isETHAddress } from '../utils';
import { IDexHelper } from '../dex-helper';
import { extractReturnAmountPosition } from '../executor/utils';

const DODOApproveAddress: { [network: number]: Address } = {
  [Network.MAINNET]: '0xCB859eA579b28e02B87A1FDE08d087ab9dbE5149',
  [Network.BSC]: '0xa128Ba44B2738A558A1fdC06d6303d52D3Cef8c1',
  [Network.POLYGON]: '0x6D310348d5c12009854DFCf72e0DF9027e8cb4f4',
  [Network.ARBITRUM]: '0xA867241cDC8d3b0C07C85cC06F25a0cD3b5474d8',
  [Network.BASE]: '0x89872650fA1A391f58B4E144222bB02e44db7e3B',
  [Network.AVALANCHE]: '0xCFea63e3DE31De53D68780Dd65675F169439e470',
};

export type DodoV2Data = {
  dodoPairs: Address[];
  directions: string;
  deadLine: string;
  dodoProxy: Address;
};
type DodoSwapV2ETHToTokenParams = [
  toToken: Address,
  minReturnAmount: NumberAsString,
  dodoPairs: Address[],
  directions: NumberAsString,
  isIncentive: boolean,
  deadLine: NumberAsString,
];
type DodoSwapV2TokenToETHParams = [
  fromToken: Address,
  fromTokenAmount: NumberAsString,
  minReturnAmount: NumberAsString,
  dodoPairs: Address[],
  directions: NumberAsString,
  isIncentive: boolean,
  deadLine: NumberAsString,
];
type DodoSwapV2TokenToTokenParams = [
  fromToken: Address,
  toToken: Address,
  fromTokenAmount: NumberAsString,
  minReturnAmount: NumberAsString,
  dodoPairs: Address[],
  directions: NumberAsString,
  isIncentive: boolean,
  deadLine: NumberAsString,
];
type DodoV2Param =
  | DodoSwapV2ETHToTokenParams
  | DodoSwapV2TokenToETHParams
  | DodoSwapV2TokenToTokenParams;
enum DodoV2Functions {
  dodoSwapV2ETHToToken = 'dodoSwapV2ETHToToken',
  dodoSwapV2TokenToETH = 'dodoSwapV2TokenToETH',
  dodoSwapV2TokenToToken = 'dodoSwapV2TokenToToken',
}

export class DodoV2
  extends SimpleExchange
  implements IDexTxBuilder<DodoV2Data, DodoV2Param>
{
  static dexKeys = ['dodov2'];
  exchangeRouterInterface: Interface;

  needWrapNative = true; // temporary

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'dodov2');
    this.exchangeRouterInterface = new Interface(
      DodoV2ProxyABI as JsonFragment[],
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: DodoV2Data,
    side: SwapSide,
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
      targetExchange: data.dodoProxy, // warning
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: DodoV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const [swapFunction, swapFunctionParams, maybeSpender] = ((): [
      DodoV2Functions,
      DodoV2Param,
      Address?,
    ] => {
      if (isETHAddress(srcToken)) {
        return [
          DodoV2Functions.dodoSwapV2ETHToToken,
          [
            destToken,
            destAmount,
            data.dodoPairs,
            data.directions,
            false,
            MAX_UINT,
          ],
        ];
      }

      if (isETHAddress(destToken)) {
        return [
          DodoV2Functions.dodoSwapV2TokenToETH,
          [
            srcToken,
            srcAmount,
            destAmount,
            data.dodoPairs,
            data.directions,
            false,
            MAX_UINT,
          ],
          DODOApproveAddress[this.network],
        ];
      }

      return [
        DodoV2Functions.dodoSwapV2TokenToToken,
        [
          srcToken,
          destToken,
          srcAmount,
          destAmount,
          data.dodoPairs,
          data.directions,
          false,
          MAX_UINT,
        ],
        DODOApproveAddress[this.network],
      ];
    })();

    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.dodoProxy,
      maybeSpender,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _recipient: Address,
    data: DodoV2Data,
    _side: SwapSide,
  ): DexExchangeParam {
    const [swapFunction, swapFunctionParams, maybeSpender] = ((): [
      DodoV2Functions,
      DodoV2Param,
      Address?,
    ] => {
      if (isETHAddress(srcToken)) {
        return [
          DodoV2Functions.dodoSwapV2ETHToToken,
          [
            destToken,
            destAmount,
            data.dodoPairs,
            data.directions,
            false,
            MAX_UINT,
          ],
        ];
      }

      if (isETHAddress(destToken)) {
        return [
          DodoV2Functions.dodoSwapV2TokenToETH,
          [
            srcToken,
            srcAmount,
            destAmount,
            data.dodoPairs,
            data.directions,
            false,
            MAX_UINT,
          ],
          DODOApproveAddress[this.network],
        ];
      }

      return [
        DodoV2Functions.dodoSwapV2TokenToToken,
        [
          srcToken,
          destToken,
          srcAmount,
          destAmount,
          data.dodoPairs,
          data.directions,
          false,
          MAX_UINT,
        ],
        DODOApproveAddress[this.network],
      ];
    })();

    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: data.dodoProxy,
      spender: maybeSpender,
      returnAmountPos:
        _side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.exchangeRouterInterface,
              swapFunction,
              'returnAmount',
            )
          : undefined,
    };
  }
}
