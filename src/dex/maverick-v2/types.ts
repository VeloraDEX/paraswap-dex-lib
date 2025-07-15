import { Address, NumberAsString } from '../../types';

export type Bin = {
  mergeBinBalance: bigint;
  mergeId: bigint;
  totalSupply: bigint;
  kind: bigint;
  tick: bigint;
  tickBalance: bigint;
};

export type BinDelta = {
  deltaA: bigint;
  deltaB: bigint;
};

export type TickData = {
  currentReserveA: bigint;
  currentReserveB: bigint;
  currentLiquidity: bigint;
};

export type AddLiquidityInfo = {
  deltaA: bigint;
  deltaB: bigint;
  tickLtActive: boolean;
  tickSpacing: bigint;
  tick: bigint;
};

export type MoveData = {
  kind: bigint;
  tickSearchStart: bigint;
  tickSearchEnd: bigint;
  tickLimit: bigint;
  firstBinTick: bigint;
  firstBinId: bigint;
  mergeBinBalance: bigint;
  totalReserveA: bigint;
  totalReserveB: bigint;
  mergeBins: { [id: string]: bigint };
  counter: bigint;
};

export type Tick = {
  reserveA: bigint;
  reserveB: bigint;
  totalSupply: bigint;
  binIdsByTick: { [id: string]: bigint };
};

export type RemoveLiquidityParams = {
  binIds: bigint[];
  amounts: bigint[];
};

export type AddLiquidityParams = {
  ticks: bigint[];
  amounts: bigint[];
  kind: bigint;
};

export type PoolState = {
  activeTick: bigint;
  binCounter: bigint;
  reserveA: bigint;
  reserveB: bigint;
  lastTwaD8: bigint;
  lastLogPriceD8: bigint;
  lastTimestamp: bigint;
  bins: { [id: string]: Bin };
  ticks: { [id: string]: Tick };
};

export interface SubgraphToken {
  id: string;
  symbol: string;
  name: string;
}

export interface SubgraphPoolBase {
  id: string;
  tickSpacing: number;
  fee: number;
  lookback: number;
  protocolFeeRatio: number;
  tokenA: SubgraphToken;
  tokenB: SubgraphToken;
}

export type MaverickV2Data = {
  pool: Address;
  tokenA: Address;
  tokenB: Address;
  activeTick: string;
};

export interface SubgraphPoolBase {
  id: string;
  tickSpacing: number;
  feeAIn: number;
  feeBIn: number;
  lookback: number;
  protocolFeeRatio: number;
  tokenA: SubgraphToken;
  tokenB: SubgraphToken;
}

type SwapParams = {
  amount: NumberAsString;
  tokenAIn: boolean;
  exactOutput: boolean;
  tickLimit: NumberAsString;
};

export type MaverickV2Param = {
  recipient: Address;
  params: SwapParams;
  data: string;
};

export type DexParams = {
  routerAddress: string;
  quoterAddress: string;
  poolLensAddress: string;
};

export type PoolAPIResponse = {
  pools: {
    fee: number;
    feeB: number;
    lookback: number;
    lowerTick: number;
    tickSpacing: number;
    id: string;
    volume: {
      amount: number;
    };
    tokenA: {
      name: string;
      symbol: string;
      address: string;
      decimals: number;
    };
    tokenB: {
      name: string;
      symbol: string;
      address: string;
      decimals: number;
    };
    tvl: {
      amount: number;
    };
  }[];
};
