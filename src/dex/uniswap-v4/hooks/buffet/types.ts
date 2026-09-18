import { Address } from '@paraswap/core';

export type HookParams = {
  hookAddress: Address;
  priceEngine: Address;
  poolManager: Address;
  poolId: string;
  token0: Address;
  token1: Address;
  fee: string;
  tickSpacing: string;
};

export type BuffetEngineState = {
  priceE6: bigint;
  depth: bigint;
  expiryTs: bigint;
  ethBal: bigint;
  usdcBal: bigint;
  blockTs: bigint;
};
