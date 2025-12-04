import { Address, NumberAsString } from '../../types';

export type ApexDefiPoolState = {
  reserve0: bigint;
  reserve1: bigint;
  baseSwapRate: number;
  // This is a % of the baseSwapRate
  protocolFee: number;
  // This is a % of the baseSwapRate
  lpFee: number;
  // This is a % additional to the baseSwapRate
  tradingFee: number;
  isLegacy: boolean;
  tradingEnabled: boolean;
};

export type ApexDefiData = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
  }[];
  swapType: 'direct' | 'router' | 'wrapper';
  wrapperAddress?: Address;
  isWrap?: boolean; // true for wrap (USDC->aUSDC), false for unwrap (aUSDC->USDC)
};

export type DexParams = {
  factoryAddress: Address;
  routerAddress: Address;
  wrapperFactoryAddress: Address;
  legacyFactoryMappings: Record<Address, Address>;
  poolGasCost: number;
};

export type ApexDefiParam = [
  amountIn: NumberAsString,
  amountOutMin: NumberAsString,
  path: Address[],
];
