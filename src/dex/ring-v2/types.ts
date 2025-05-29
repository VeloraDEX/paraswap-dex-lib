import { Address, NumberAsString } from '../../types';

export type RingDataLegacy = {
  router: Address;
  path: Address[];
  factory: Address;
  initCode: string;
  fee: number[];
  feeFactor: number;
};

export type RingData = {
  router: Address;
  pools: RingPool[];
  weth?: Address;
};

export enum RingV2Functions {
  swap = 'swap',
  buy = 'buy',
  swapOnRing = 'swapOnUniswap',
  buyOnRing = 'buyOnUniswap',
  swapOnRingFork = 'swapOnUniswapFork',
  buyOnRingFork = 'buyOnUniswapFork',
  swapOnRingV2Fork = 'swapOnUniswapV2Fork',
  buyOnRingV2Fork = 'buyOnUniswapV2Fork',
  swapOnRingV2ForkWithPermit = 'swapOnUniswapV2ForkWithPermit',
  buyOnRingV2ForkWithPermit = 'buyOnUniswapV2ForkWithPermit',
  swapExactTokensForTokens = 'swapExactTokensForTokens',
  swapExactETHForTokens = 'swapExactETHForTokens',
  swapTokensForExactTokens = 'swapTokensForExactTokens',
  swapTokensForExactETH = 'swapTokensForExactETH',
  swapETHForExactTokens = 'swapETHForExactTokens',
}
//ring_todo, augu sdk has no swapExactAmountInOnRingV2
//sdk
export enum RingV2FunctionsV6 {
  swap = 'swapExactAmountInOnRingV2',
  buy = 'swapExactAmountOutOnRingV2',
}

export type RingV2ParamsDirectBase = [
  srcToken: Address,
  destToken: Address,
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  quotedAmount: NumberAsString,
  metadata: string,
  beneficiary: Address,
  pools: string,
];

export type RingV2ParamsDirect = [
  params: RingV2ParamsDirectBase,
  partnerAndFee: string,
  permit: string,
];

export type SwapOnRingParam = [
  amountIn: NumberAsString,
  amountOutMin: NumberAsString,
  path: Address[],
];

export type BuyOnRingParam = [
  amountInMax: NumberAsString,
  amountOut: NumberAsString,
  path: Address[],
];

export type SwapOnRingForkParam = [
  factory: Address,
  initCode: string,
  amountIn: NumberAsString,
  amountOutMin: NumberAsString,
  path: Address[],
];

export type BuyOnRingForkParam = [
  factory: Address,
  initCode: string,
  amountInMax: NumberAsString,
  amountOut: NumberAsString,
  path: Address[],
];

export type SwapOnRingV2ForkParam = [
  tokenIn: Address,
  amountIn: NumberAsString,
  amountOutMin: NumberAsString,
  weth: Address,
  pools: NumberAsString[],
];

export type BuyOnRingV2ForkParam = [
  tokenIn: Address,
  amountInMax: NumberAsString,
  amountOut: NumberAsString,
  weth: Address,
  pools: NumberAsString[],
];

export type SwapOnRingV2ForkWithPermitParam = [
  tokenIn: Address,
  amountIn: NumberAsString,
  amountOutMin: NumberAsString,
  weth: Address,
  pools: NumberAsString[],
  permit: string,
];

export type BuyOnRingV2ForkWithPermitParam = [
  tokenIn: Address,
  amountInMax: NumberAsString,
  amountOut: NumberAsString,
  weth: Address,
  pools: NumberAsString[],
  permit: string,
];

export type RingParam =
  | SwapOnRingParam
  | BuyOnRingParam
  | SwapOnRingForkParam
  | BuyOnRingForkParam
  | SwapOnRingV2ForkParam
  | BuyOnRingV2ForkParam
  | SwapOnRingV2ForkWithPermitParam
  | BuyOnRingV2ForkWithPermitParam;

export type RingPool = {
  address: Address;
  direction: boolean;
  fee: number;
};

export type RingV2Data = {
  router: Address;
  path: Address[];
  pools: {
    address: Address;
    direction: boolean;
    fee: number;
  }[];
  factory: Address;
  initCode: string;
  feeFactor: number;
  wethAddress?: string;
};

export interface DexParams {
  subgraphType?: 'subgraphs' | 'deployments';
  subgraphURL?: string;
  factoryAddress: Address;
  initCode: string; // deprecated
  poolGasCost?: number;
  feeCode: number;
  router?: Address;
  adapters?: { [side: string]: { name: string; index: number }[] | null };
}

export interface RingV2PoolOrderedParams {
  tokenIn: string;
  tokenOut: string;
  reservesIn: string;
  reservesOut: string;
  fee: string;
  direction: boolean;
  exchange: string;
}
