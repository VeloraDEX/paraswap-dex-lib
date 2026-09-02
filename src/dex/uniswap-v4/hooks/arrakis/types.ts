import { Address } from '@paraswap/core';

export type HookParams = {
  hookAddress: Address;
};

export type PoolFeesData = {
  module: Address;
  zeroForOneFee: bigint;
  oneForZeroFee: bigint;
};
