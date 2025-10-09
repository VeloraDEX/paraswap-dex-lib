import { Address, NumberAsString } from '../../types';

export type ModifyLiquidityParams = {
  liquidityDelta: bigint;
  tickLower: bigint;
  tickUpper: bigint;
  tickSpacing: bigint;
};

export type TickInfo = {
  liquidityGross: bigint;
  liquidityNet: bigint;
};

export type PoolManagerState = Record<string, never>;

export type PoolState = {
  id: string;
  token0: string;
  token1: string;
  fee: string;
  hooks: string;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  liquidity: bigint;
  slot0: Slot0;
  tickSpacing: number;
  ticks: Record<NumberAsString, TickInfo>;
  tickBitmap: Record<NumberAsString, bigint>;
  isValid: boolean;
};

export type FeeGrowthGlobals = {
  feeGrowthGlobal0: bigint;
  feeGrowthGlobal1: bigint;
};

export type Slot0 = {
  sqrtPriceX96: bigint;
  tick: bigint;
  protocolFee: bigint;
  lpFee: bigint;
};

export type PoolPairsInfo = {
  poolId: string;
};

export type UniswapV4Data = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
    zeroForOne: boolean;
    pool: Pool;
  }[];
};

export type Pool = {
  id: string;
  key: PoolKey;
};

export type OutputResult = {
  outputs: bigint[];
  tickCounts: number[];
};

export type SubgraphConnectorPool = {
  id: string;
  volumeUSD: string;
  token0: {
    address: string;
    decimals: string;
  };
  token1: {
    address: string;
    decimals: string;
  };
};

export type SubgraphTick = {
  tickIdx: string;
  liquidityGross: string;
  liquidityNet: string;
};

export type SubgraphPool = {
  id: string;
  fee: string;
  hooks: string;
  volumeUSD?: string;
  token0: {
    address: string;
  };
  token1: {
    address: string;
  };
  tickSpacing: string;
};

export type DexParams = {
  poolManager: Address;
  quoter: Address;
  router: Address;
  subgraphURL: string;
  stateView: string;
  skipPoolsWithUnconventionalFees?: boolean;
  stateMulticall: string;
};

export type PoolKey = {
  // The lower currency of the pool, sorted numerically
  currency0: Address;
  // The higher currency of the pool, sorted numerically
  currency1: Address;
  // The pool LP fee, capped at 1_000_000. If the highest bit is 1, the pool has a dynamic fee and must be exactly equal to 0x800000
  fee: string;
  // Ticks that involve positions must be a multiple of tick spacing
  tickSpacing: number;
  // The hooks of the pool
  hooks: Address;
};
