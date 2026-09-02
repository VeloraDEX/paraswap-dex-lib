import { Address } from '@paraswap/core';

export type HookParams = {
  hookAddress: Address;
  factoryAddress: Address; // ArrakisMetaVaultFactory, used for on-chain pool discovery
};

export type PoolFeesData = {
  module: Address;
  zeroForOneFee: bigint;
  oneForZeroFee: bigint;
};
