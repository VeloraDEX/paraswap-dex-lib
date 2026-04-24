import { Address } from '../../types';

export type DexParams = {
  clPoolManager: Address;
  router: Address;
  subgraphURL: string;
};

export type SubgraphConnectorPool = {
  id: string;
  totalValueLockedUSD: string;
  token0: {
    address: string;
    decimals: string;
  };
  token1: {
    address: string;
    decimals: string;
  };
};

// PoolKey as consumed by the encoder. The on-chain tuple has a final
// `bytes32 parameters` field instead of `tickSpacing` — for CL pools it
// packs `(tickSpacing << 16) | hooksRegistrationBitmap`. We currently
// reconstruct `parameters` from `tickSpacing` alone and assume the hooks
// registration bitmap is 0, which is only correct when `hooks ==
// address(0)` (or the hook contract registers no callbacks). Swaps through
// pools with registered hook callbacks will revert because the poolId hash
// won't match. See `encodeParameters` in ./encoder.ts.
export type PoolKey = {
  currency0: string;
  currency1: string;
  hooks: string;
  poolManager: string;
  fee: string;
  tickSpacing: number;
};

export type Pool = {
  id: string;
  key: PoolKey;
};

export type PathStep = {
  pool: Pool;
  tokenIn: string;
  tokenOut: string;
  zeroForOne: boolean;
};

export type PancakeSwapInfinityData = {
  path: PathStep[];
};
