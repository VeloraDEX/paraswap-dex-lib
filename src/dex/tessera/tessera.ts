import { Interface, JsonFragment } from '@ethersproject/abi';
import { SwapSide } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import TesseraSwapABI from '../../abi/tessera/TesseraSwap.json';
import { IDexHelper } from '../../dex-helper';
import { TesseraConfig } from './config';

export class Tessera extends SimpleExchange implements IDexTxBuilder<null> {
  static dexKeys = ['tessera'];
  needWrapNative = true;

  readonly routerInterface: Interface;
  readonly routerAddress: Address;

  constructor(readonly dexHelper: IDexHelper) {
    super(dexHelper, 'tessera');
    this.routerInterface = new Interface(TesseraSwapABI as JsonFragment[]);

    const config = TesseraConfig[this.network];
    if (!config) {
      throw new Error(`Tessera: unsupported network ${this.network}`);
    }
    this.routerAddress = config.routerAddress;
  }

  getAdapterParam(): AdapterExchangeParam {
    throw new Error('Tessera: V5 not supported');
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    _data: null,
    side: SwapSide,
  ): DexExchangeParam {
    const tokenIn = this.dexHelper.config.wrapETH(srcToken);
    const tokenOut = this.dexHelper.config.wrapETH(destToken);

    const isSell = side === SwapSide.SELL;
    const amountSpecified = isSell ? srcAmount : `-${destAmount}`;
    const amountCheck = isSell ? '0' : srcAmount;

    const swapCalldata = this.routerInterface.encodeFunctionData(
      'tesseraSwapWithAllowances',
      [tokenIn, tokenOut, amountSpecified, amountCheck, recipient, '0x'],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapCalldata,
      targetExchange: this.routerAddress,
    };
  }
}
