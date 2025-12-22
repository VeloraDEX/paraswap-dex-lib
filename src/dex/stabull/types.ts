export type PoolState = {
  reserves0: bigint;
  reserves1: bigint;
};

export type StabullData = {
  poolAddress: string; // The address of the pool being used
};

export type TokenConfig = {
  address: string;
  decimals: number;
};

export type PoolsConfig = {
  [poolAddress: string]: {
    tokens: TokenConfig[];
  };
};

export type DexParams = {
  router: string;
  quoteCurrency: string;
  pools: PoolsConfig;
};
