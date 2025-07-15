import { Address, NumberAsString } from '../../types';

export type PoolState = {
  reserve0: bigint;
  reserve1: bigint;
  fee: number;
  tradingFee: number;
};

export type ApexDefiData = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
  }[];
};

export type DexParams = {
  factoryAddress: Address;
  routerAddress: Address;
  wrapperFactoryAddress: Address;
};

export type ApexDefiParam = [
  amountIn: NumberAsString,
  amountOutMin: NumberAsString,
  path: Address[],
];
