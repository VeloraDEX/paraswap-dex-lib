import { Address, NumberAsString } from '../../types';

export type PoolState = {
  // TODO: poolState is the state of event
  // subscriber. This should be the minimum
  // set of parameters required to compute
  // pool prices. Complete me!
};

export type ApexDeFiData = {
  pairs: ApexDeFiPair[];
};

export type DexParams = {
  // TODO: DexParams is set of parameters the can
  // be used to initiate a DEX fork.
  // Complete me!
  factoryAddress: Address;
};

export type ApexDeFiPair = {
  address: Address;
};

export type ApexDeFiBuyParams = {
  amountIn: NumberAsString;
  amountOutMin: NumberAsString;
  deadline: string;
};

export type ApexDeFiSellParams = {
  amountIn: NumberAsString;
  amountOutMin: NumberAsString;
  deadline: string;
};

export enum ApexDeFiSwapFunctions {
  swapNativeToToken = 'swapNativeToToken',
  swapTokenToNative = 'swapTokenToNative',
}
