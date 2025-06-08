import { Network, SwapSide } from '../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  SimpleExchangeParam,
} from '../types';
import { IDexTxBuilder } from './idex';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from './simple-exchange';
import UniswapV3RouterABI from '../abi/UniswapV3Router.json';
import { NumberAsString } from '@paraswap/core';
import { IDexHelper } from '../dex-helper';
import { extractReturnAmountPosition } from '../executor/utils';
import { solidityPacked, Interface, JsonFragment } from 'ethers';

const UNISWAP_V3_ROUTER_ADDRESSES: { [network: number]: Address } = {
  [Network.MAINNET]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  [Network.POLYGON]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  [Network.ARBITRUM]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  [Network.OPTIMISM]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
};

export type UniswapV3Data = {
  // ExactInputSingleParams
  path: {
    tokenIn: Address;
    tokenOut: Address;
    fee: number;
  }[];
};

type UniswapV3SellParam = {
  path: string;
  recipient: Address;
  deadline: string;
  amountIn: NumberAsString;
  amountOutMinimum: NumberAsString;
};

type UniswapV3BuyParam = {
  path: string;
  recipient: Address;
  deadline: string;
  amountOut: NumberAsString;
  amountInMaximum: NumberAsString;
};

export type UniswapV3Param = UniswapV3SellParam | UniswapV3BuyParam;

enum UniswapV3Functions {
  exactInput = 'exactInput',
  exactOutput = 'exactOutput',
}

export class UniswapV3
  extends SimpleExchange
  implements IDexTxBuilder<UniswapV3Data, UniswapV3Param>
{
  static dexKeys = ['uniswapv3'];
  exchangeRouterInterface: Interface;
  needWrapNative = true;
  protected routerAddress: string;

  constructor(dexHelper: IDexHelper, dexKey: string, routerAddress?: Address) {
    super(dexHelper, dexKey);
    this.exchangeRouterInterface = new Interface(
      UniswapV3RouterABI as JsonFragment[],
    );
    this.routerAddress =
      routerAddress || UNISWAP_V3_ROUTER_ADDRESSES[this.network];
  }

  protected encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      fee: number;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      return '0x';
    }

    const { _path, types } = path.reduce(
      (
        { _path, types }: { _path: string[]; types: string[] },
        curr,
        index,
      ): { _path: string[]; types: string[] } => {
        if (index === 0) {
          return {
            types: ['address', 'uint24', 'address'],
            _path: [curr.tokenIn, curr.fee.toString(), curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'uint24', 'address'],
            _path: [..._path, curr.fee.toString(), curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? solidityPacked(types.reverse(), _path.reverse())
      : solidityPacked(types, _path);
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: UniswapV3Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { path: rawPath } = data;
    const path = this.encodePath(rawPath, side);
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          path: 'bytes',
          deadline: 'uint256',
        },
      },
      {
        path,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(), // FIXME: more gas efficient to pass block.timestamp in adapter
      },
    );

    return {
      targetExchange: this.routerAddress,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: UniswapV3Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapFunction =
      side === SwapSide.SELL
        ? UniswapV3Functions.exactInput
        : UniswapV3Functions.exactOutput;
    const path = this.encodePath(data.path, side);
    const swapFunctionParams: UniswapV3Param =
      side === SwapSide.SELL
        ? {
            recipient: this.augustusAddress,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountIn: srcAmount,
            amountOutMinimum: destAmount,
            path,
          }
        : {
            recipient: this.augustusAddress,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountOut: destAmount,
            amountInMaximum: srcAmount,
            path,
          };
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapFunction,
      [swapFunctionParams],
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
    data: UniswapV3Data,
    side: SwapSide,
  ): DexExchangeParam {
    const swapFunction =
      side === SwapSide.SELL
        ? UniswapV3Functions.exactInput
        : UniswapV3Functions.exactOutput;

    const path = this.encodePath(data.path, side);

    const swapFunctionParams: UniswapV3Param =
      side === SwapSide.SELL
        ? {
            recipient,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountIn: srcAmount,
            amountOutMinimum: destAmount,
            path,
          }
        : {
            recipient,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountOut: destAmount,
            amountInMaximum: srcAmount,
            path,
          };

    const exchangeData = this.exchangeRouterInterface.encodeFunctionData(
      swapFunction,
      [swapFunctionParams],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
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
