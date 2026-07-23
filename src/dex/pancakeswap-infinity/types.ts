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
// packs `(tickSpacing << 16) | hooksRegistrationBitmap`. The encoder
// reconstructs it via `encodeParameters` in ./encoder.ts, resolving the
// bitmap from a hardcoded `hooks` → bitmap table (defaults to 0 for
// hookless pools or unknown hooks).
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
