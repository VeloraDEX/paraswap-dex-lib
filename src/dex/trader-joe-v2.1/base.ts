import { SwapSide } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  SimpleExchangeParam,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import { IDexHelper } from '../../dex-helper';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { NumberAsString } from '@paraswap/core';
import { AsyncOrSync } from 'ts-essentials';
import TraderJoeV21RouterABI from '../../abi/TraderJoeV21Router.json';
import {
  TraderJoeV2Data,
  TraderJoeV2RouterFunctions,
  TraderJoeV2RouterParam,
} from './types';
import { extractReturnAmountPosition } from '../../executor/utils';
import { Interface, JsonFragment } from 'ethers';

export class BaseTraderJoeV2
  extends SimpleExchange
  implements IDexTxBuilder<TraderJoeV2Data, TraderJoeV2RouterParam>
{
  exchangeRouterInterface: Interface;

  constructor(
    dexHelper: IDexHelper,
    dexKey: string,
    protected routerAddress: string,
    protected versionIndex: string,
  ) {
    super(dexHelper, dexKey);

    this.exchangeRouterInterface = new Interface(
      TraderJoeV21RouterABI as JsonFragment[],
    );
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: TraderJoeV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    let payload = this.abiCoder.encodeParameters(
      ['tuple(tuple(uint256[],uint8[],address[]),uint256)'],
      [
        [
          [data.binSteps, data.versions, data.tokenPath],
          getLocalDeadlineAsFriendlyPlaceholder(), // _deadline: uint256
        ],
      ],
    );

    return {
      targetExchange: this.routerAddress,
      payload,
      networkFee: '0',
    };
  }

  getSimpleParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: TraderJoeV2Data,
    side: SwapSide,
  ): AsyncOrSync<SimpleExchangeParam> {
    const swapFunction =
      side === SwapSide.SELL
        ? TraderJoeV2RouterFunctions.swapExactTokensForTokens
        : TraderJoeV2RouterFunctions.swapTokensForExactTokens;

    const swapFunctionParams: TraderJoeV2RouterParam =
      side === SwapSide.SELL
        ? [
            srcAmount,
            destAmount,
            [data.binSteps, data.versions, data.tokenPath],
            this.augustusAddress,
            getLocalDeadlineAsFriendlyPlaceholder(),
          ]
        : [
            destAmount,
            srcAmount,
            [data.binSteps, data.versions, data.tokenPath],
            this.augustusAddress,
            getLocalDeadlineAsFriendlyPlaceholder(),
          ];

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
      this.routerAddress,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: TraderJoeV2Data,
    side: SwapSide,
  ): DexExchangeParam {
    const swapFunction =
      side === SwapSide.SELL
        ? TraderJoeV2RouterFunctions.swapExactTokensForTokens
        : TraderJoeV2RouterFunctions.swapTokensForExactTokens;

    const placeholder = getLocalDeadlineAsFriendlyPlaceholder();

    const swapFunctionParams: TraderJoeV2RouterParam =
      side === SwapSide.SELL
        ? [
            srcAmount,
            destAmount,
            [data.binSteps, data.versions, data.tokenPath],
            recipient,
            placeholder,
          ]
        : [
            destAmount,
            srcAmount,
            [data.binSteps, data.versions, data.tokenPath],
            recipient,
            placeholder,
          ];

    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.routerAddress,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.exchangeRouterInterface,
              swapFunction,
              'amountOut',
            )
          : undefined,
    };
  }
}
