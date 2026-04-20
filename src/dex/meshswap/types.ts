import { Address, NumberAsString, Token } from '../../types';

export type MeshswapDataLegacy = {
  router: Address;
  path: Address[];
  factory: Address;
  fee: number[];
  feeFactor: number;
};

export enum MeshswapFunctions {
  swapExactTokensForTokens = 'swapExactTokensForTokens',
  swapTokensForExactTokens = 'swapTokensForExactTokens',
  swapExactETHForTokens = 'swapExactETHForTokens',
  swapTokensForExactETH = 'swapTokensForExactETH',
  swapExactTokensForETH = 'swapExactTokensForETH',
  swapETHForExactTokens = 'swapETHForExactTokens',
}

export type SwapOnMeshswapParam = [
  srcAmount: string,
  destAmount: string,
  path: string[],
  to: string,
  deadline: string,
];

export type BuyOnMeshswapParam = [
  srcAmount: string,
  destAmount: string,
  path: string[],
  to: string,
  deadline: string,
];

export type SwapOnETHMeshswapParam = [
  destAmount: string,
  path: string[],
  to: string,
  deadline: string,
];

export type BuyOnETHMeshswapParam = [
  destAmount: string,
  path: string[],
  to: string,
  deadline: string,
];

export type MeshswapParam =
  | SwapOnMeshswapParam
  | BuyOnMeshswapParam
  | SwapOnETHMeshswapParam
  | BuyOnETHMeshswapParam;

export type MeshswapPool = {
  address: Address;
  direction: boolean;
  fee: number;
};

export type MeshswapData = {
  router: Address;
  path: Address[];
  pools: {
    address: Address;
    direction: boolean;
    fee: number;
  }[];
  factory: Address;
  feeFactor: number;
  weth?: string;
};

export type DexParams = {
  subgraphURL?: string;
  factoryAddress: Address;
  poolGasCost?: number;
  feeCode: number;
  router?: Address;
  adapters?: { [side: string]: { name: string; index: number }[] | null };
};
