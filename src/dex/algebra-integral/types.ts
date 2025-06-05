import { Address } from '../../types';

export type AlgebraIntegralData = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
    deployer: Address;
  }[];
  feeOnTransfer: boolean;
  isApproved?: boolean;
};

export type AlgebraDataWithFee = {
  tokenIn: Address;
  tokenOut: Address;
};

export type DexParams = {
  factory: Address;
  quoter: Address;
  router: Address;
  subgraphURL: string;
  uniswapMulticall: Address;
  chunksCount: number;
};

export type Pool = {
  poolAddress: Address;
  token0: Address;
  token1: Address;
  deployer: string;
  tvlUSD: number;
};

export type FactoryState = Record<string, never>;

export enum AlgebraIntegralFunctions {
  exactInput = 'exactInput',
  exactOutput = 'exactOutput',
  exactInputWithFeeToken = 'exactInputSingleSupportingFeeOnTransferTokens',
}
