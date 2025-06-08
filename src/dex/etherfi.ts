import { Interface, JsonFragment } from 'ethers';
import { ETHER_ADDRESS, NULL_ADDRESS, SwapSide } from '../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  NumberAsString,
  SimpleExchangeParam,
} from '../types';
import { IDexTxBuilder } from './idex';
import { SimpleExchange } from './simple-exchange';
import eETHPoolABI from '../abi/etherfi/eETHPool.json';
import weETHABI from '../abi/etherfi/weETH.json';
import { IDexHelper } from '../dex-helper';
import { isETHAddress } from '../utils';
import { assert } from 'ts-essentials';
import { WethFunctions } from './weth/types';
import { extractReturnAmountPosition } from '../executor/utils';

type EtherFiData = void;

type eETHPoolDepositParam = [];
type weETHWrap = [_eETHAmount: string];
type weETHUnwrap = [_weETHAmount: string];

type EtherFiParam = eETHPoolDepositParam | weETHWrap | weETHUnwrap;

enum EtherFiFunctions {
  deposit = 'deposit',
  wrap = 'wrap',
  unwrap = 'unwrap',
}

const EtherFiConfig: Record<
  number,
  { eETH: string; eETHPool: string; weETH: string }
> = {
  1: {
    eETH: '0x35fa164735182de50811e8e2e824cfb9b6118ac2',
    eETHPool: '0x308861a430be4cce5502d0a12724771fc6daf216',
    weETH: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee',
  },
};

export class EtherFi
  extends SimpleExchange
  implements IDexTxBuilder<EtherFiData, EtherFiParam>
{
  static dexKeys = ['etherfi'];

  eETHPoolInterface: Interface;
  weETHInterface: Interface;
  needWrapNative = false;

  eETH: string;
  eETHPool: string;
  weETH: string;

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'etherfi');

    this.eETHPoolInterface = new Interface(eETHPoolABI as JsonFragment[]);
    this.weETHInterface = new Interface(weETHABI as JsonFragment[]);

    this.eETH = EtherFiConfig[this.network].eETH.toLowerCase();
    this.eETHPool = EtherFiConfig[this.network].eETHPool.toLowerCase();
    this.weETH = EtherFiConfig[this.network].weETH.toLowerCase();
  }

  is_eETH = (token: string) => token.toLowerCase() === this.eETH;
  is_weETH = (token: string) => token.toLowerCase() === this.weETH;

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: EtherFiData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      EtherFiFunctions,
      EtherFiParam,
    ] => {
      if (this.is_weETH(destToken)) {
        assert(this.is_eETH(srcToken), 'srcToken should be eETH');
        return [
          this.weETHInterface,
          this.weETH,
          EtherFiFunctions.wrap,
          [srcAmount],
        ];
      }

      if (this.is_weETH(srcToken)) {
        assert(this.is_eETH(destToken), 'destToken should be eETH');
        return [
          this.weETHInterface,
          this.weETH,
          EtherFiFunctions.unwrap,
          [srcAmount],
        ];
      }

      if (this.is_eETH(destToken)) {
        assert(
          this.isWETH(srcToken) || isETHAddress(srcToken),
          'srcToken should be (w)eth',
        );
        return [
          this.eETHPoolInterface,
          this.eETHPool,
          EtherFiFunctions.deposit,
          [],
        ];
      }

      throw new Error('LOGIC ERROR');
    })();

    const swapData = Interface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    // if src token is WETH, we need to withdraw from weth and pass eth value on call. For other cases, we need to approve and perform call
    const isSrcTokenWeth = this.isWETH(srcToken);
    const skipApproval = this.is_weETH(srcToken) && this.is_eETH(destToken);

    return this.buildSimpleParamWithoutWETHConversion(
      isSrcTokenWeth ? ETHER_ADDRESS : srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      swapCallee,
      swapCallee,
      '0',
      isSrcTokenWeth
        ? {
            callees: [this.dexHelper.config.data.wrappedNativeTokenAddress],
            calldata: [
              this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
                srcAmount,
              ]),
            ],
            values: ['0'],
          }
        : undefined,
      skipApproval,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
  ): DexExchangeParam {
    const is_eETH_dest = this.is_eETH(destToken);
    const isWETH_src = this.isWETH(srcToken);

    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      EtherFiFunctions,
      EtherFiParam,
    ] => {
      if (this.is_weETH(destToken)) {
        assert(this.is_eETH(srcToken), 'srcToken should be eETH');
        return [
          this.weETHInterface,
          this.weETH,
          EtherFiFunctions.wrap,
          [srcAmount],
        ];
      }

      if (this.is_weETH(srcToken)) {
        assert(is_eETH_dest, 'destToken should be eETH');
        return [
          this.weETHInterface,
          this.weETH,
          EtherFiFunctions.unwrap,
          [srcAmount],
        ];
      }

      if (is_eETH_dest) {
        assert(
          isWETH_src || isETHAddress(srcToken),
          'srcToken should be (w)eth',
        );
        return [
          this.eETHPoolInterface,
          this.eETHPool,
          EtherFiFunctions.deposit,
          [],
        ];
      }

      throw new Error('LOGIC ERROR');
    })();

    const swapData = Interface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    const skipApproval = this.is_weETH(srcToken) && this.is_eETH(destToken);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: swapCallee,
      spender: swapCallee,
      swappedAmountNotPresentInExchangeData: is_eETH_dest,
      preSwapUnwrapCalldata: isWETH_src
        ? this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
            srcAmount,
          ])
        : undefined,
      returnAmountPos: extractReturnAmountPosition(Interface, swapFunction),
      skipApproval,
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: EtherFiData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: NULL_ADDRESS,
      payload: '0x',
      networkFee: '0',
    };
  }
}
