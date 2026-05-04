import { Interface, JsonFragment } from '@ethersproject/abi';
import { SwapSide } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import MetricOmmSwapRouterABI from '../../abi/metric/MetricOmmSwapRouter.json';
import { IDexHelper } from '../../dex-helper';
import { MetricData } from './types';
import {
  MetricConfig,
  PRICE_LIMIT_ONE_FOR_ZERO,
  PRICE_LIMIT_ZERO_FOR_ONE,
} from './config';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Metric
  extends SimpleExchange
  implements IDexTxBuilder<MetricData>
{
  static dexKeys = ['metric'];
  needWrapNative = true;

  readonly routerInterface: Interface;
  readonly routerAddress: Address;

  constructor(readonly dexHelper: IDexHelper) {
    super(dexHelper, 'metric');
    this.routerInterface = new Interface(
      MetricOmmSwapRouterABI as JsonFragment[],
    );

    const config = MetricConfig[this.network];
    if (!config) {
      throw new Error(`Metric: unsupported network ${this.network}`);
    }
    this.routerAddress = config.routerAddress;
  }

  private getPriceLimit(zeroForOne: boolean): string {
    return zeroForOne ? PRICE_LIMIT_ZERO_FOR_ONE : PRICE_LIMIT_ONE_FOR_ZERO;
  }

  getAdapterParam(): AdapterExchangeParam {
    throw new Error('Metric: V5 not supported');
  }

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: MetricData,
    side: SwapSide,
  ): DexExchangeParam {
    const deadline = getLocalDeadlineAsFriendlyPlaceholder();
    const priceLimit = this.getPriceLimit(data.zeroForOne);

    const swapFunction =
      side === SwapSide.SELL ? 'swapExactInput' : 'swapExactOutput';

    const swapData = this.routerInterface.encodeFunctionData(swapFunction, [
      data.pool,
      recipient,
      data.zeroForOne,
      side === SwapSide.SELL ? srcAmount : destAmount,
      priceLimit,
      side === SwapSide.SELL ? '1' : srcAmount,
      deadline,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.routerAddress,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerInterface,
              'swapExactInput',
              'amountOut',
            )
          : undefined,
    };
  }
}
