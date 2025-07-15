import { NumberAsString } from '@paraswap/core';
import { Address } from '@paraswap/sdk';

export type RouterPath = [
  pairBinSteps: NumberAsString[],
  versions: NumberAsString[],
  tokenPath: Address[],
];
export type TraderJoeV2RouterSellParams = [
  _amountIn: NumberAsString,
  _amountOutMin: NumberAsString,
  _routerPath: RouterPath,
  to: Address,
  _deadline: string,
];

export type TraderJoeV2RouterBuyParams = [
  _amountOut: NumberAsString,
  _amountInMax: NumberAsString,
  _routerPath: RouterPath,
  to: Address,
  _deadline: string,
];

export type TraderJoeV2RouterParam =
  | TraderJoeV2RouterSellParams
  | TraderJoeV2RouterBuyParams;

export type TraderJoeV2Data = {
  tokenPath: string[];
  binSteps: string[];
  versions: string[];
};

export enum TraderJoeV2RouterFunctions {
  swapExactTokensForTokens = 'swapExactTokensForTokens',
  swapTokensForExactTokens = 'swapTokensForExactTokens',
}
