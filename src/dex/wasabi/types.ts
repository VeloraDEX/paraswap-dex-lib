import { Address } from '../../types';

// A sample point: [amountIn, amountOut]
export type Sample = [bigint, bigint];

// Samples for each swap direction: [baseToQuote, quoteToBase]
export type PoolSamples = [Sample[], Sample[]];

export type PoolState = {
  samples: PoolSamples;
  reserves: [bigint, bigint];
};

export type WasabiData = {
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
};

export type DexParams = {
  factoryAddress: Address;
  routerAddress: Address;
  // Basis-point buffer to apply to output amounts (e.g. 9900 = 1% discount).
  // 10000 = no buffer. 0 = disabled.
  buffer: number;
};

export type PoolInfo = {
  address: Address;
  baseToken: Address;
  quoteToken: Address;
  baseDecimals: number;
  quoteDecimals: number;
};
