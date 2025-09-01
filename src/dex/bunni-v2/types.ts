import { Address } from '../../types';

export type DexParams = {
  poolManager: Address;
  quoter: Address;
  router: Address;
  floodPlain: Address;
  bunniHub: Address;
  bunniHook: {
    address: Address;
    deploymentBlock: bigint;
  };
  liquidityDensityFunctions: Record<Address, any>;
  hooklets: Record<Address, any>;
  subgraphURL: string;
};

export type BunniV2Data = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
    zeroForOne: boolean;
    pool: {
      key: PoolKey;
    };
  }[];
};

/* -------------------------------------------------------------------------- */
/*                                   State                                    */
/* -------------------------------------------------------------------------- */

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: bigint;
  tickSpacing: bigint;
  hooks: Address;
};

export type Slot0 = {
  sqrtPriceX96: bigint;
  tick: bigint;
  lastSwapTimestamp: bigint;
  lastSurgeTimestamp: bigint;
};

export type MutablePoolState = {
  totalValueLockedUSD: bigint;
  rawBalance0: bigint;
  rawBalance1: bigint;
  reserve0: bigint;
  reserve1: bigint;
  idleBalance: string;
  totalSupply: bigint;
  ldfState: string;
  curatorFeeRate: bigint;
  rebalanceOrderHash: string;
};

export type ImmutablePoolState = {
  liquidityDensityFunction: Address;
  bunniHub: Address;
  bunniToken: Address;
  hooklet: Address;
  twapSecondsAgo: bigint;
  ldfParams: string;
  hookParams: string;
  vault0: Address;
  vault1: Address;
  ldfType: number;
  minRawTokenRatio0: bigint;
  targetRawTokenRatio0: bigint;
  maxRawTokenRatio0: bigint;
  minRawTokenRatio1: bigint;
  targetRawTokenRatio1: bigint;
  maxRawTokenRatio1: bigint;
  currency0Decimals: bigint;
  currency1Decimals: bigint;
  vault0Decimals: bigint;
  vault1Decimals: bigint;
};

export type Observation = {
  blockTimestamp: bigint;
  prevTick: bigint;
  tickCumulative: bigint;
  initialized: boolean;
};

export type ObservationState = {
  index: bigint;
  cardinality: bigint;
  cardinalityNext: bigint;
  intermediateObservation: Observation;
  observations: Observation[];
};

export type Bid = {
  manager: string;
  blockIdx: bigint;
  payload: string;
  rent: bigint;
  deposit: bigint;
};

export type AmAmmState = {
  topBid: Bid;
  nextBid: Bid;
};

export type VaultSharePrices = {
  initialized: boolean;
  sharePrice0: bigint;
  sharePrice1: bigint;
};

export type FeeOverrideHookletState = {
  overrideZeroToOne: boolean;
  feeZeroToOne: bigint;
  overrideOneToZero: boolean;
  feeOneToZero: bigint;
};

export type PoolState = {
  id: string;
  key: PoolKey;
  slot0: Slot0;
} & MutablePoolState &
  ImmutablePoolState &
  ObservationState &
  AmAmmState &
  VaultSharePrices &
  FeeOverrideHookletState;

export type VaultState = {
  address: string;
  sharePrice: bigint;
  vaultDecimals: bigint;
  currencyDecimals: bigint;
  lastSharePriceUpdate: bigint;
};

export type ProtocolState = {
  poolStates: { [poolId: string]: PoolState };
  vaultStates: { [vaultAddress: string]: VaultState };
  hookFeeModifier: bigint;
  currentK: bigint;
  pendingK: bigint;
  activeBlock: bigint;
};

/* -------------------------------------------------------------------------- */
/*                                   Logic                                    */
/* -------------------------------------------------------------------------- */

export type DepositParams = {
  amount0Desired: bigint;
  amount1Desired: bigint;
};

export type WithdrawParams = {
  shares: bigint;
};

export type SwapParams = {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
};

export type DepositLogicInputData = {
  state: PoolState;
  params: DepositParams;
  poolId: string;
  currentTick: bigint;
  sqrtPriceX96: bigint;
};

export type DepositLogicReturnData = {
  reserveAmount0: bigint;
  reserveAmount1: bigint;
  amount0: bigint;
  amount1: bigint;
  balance0: bigint;
  balance1: bigint;
};

export type BunniComputeSwapInput = {
  key: PoolKey;
  totalLiquidity: bigint;
  liquidityDensityOfRoundedTickX96: bigint;
  currentActiveBalance0: bigint;
  currentActiveBalance1: bigint;
  sqrtPriceX96: bigint;
  currentTick: bigint;
  liquidityDensityFunction: string;
  arithmeticMeanTick: bigint;
  ldfParams: string;
  ldfState: string;
  swapParams: SwapParams;
};

export type HookParams = {
  feeMin: bigint;
  feeMax: bigint;
  feeQuadraticMultiplier: bigint;
  feeTwapSecondsAgo: bigint;
  maxAmAmmFee: bigint;
  surgeFeeHalfLife: bigint;
  surgeFeeAutostartThreshold: bigint;
  vaultSurgeThreshold0: bigint;
  vaultSurgeThreshold1: bigint;
  rebalanceThreshold: bigint;
  rebalanceMaxSlippage: bigint;
  rebalanceTwapSecondsAgo: bigint;
  rebalanceOrderTTL: bigint;
  amAmmEnabled: boolean;
  oracleMinInterval: bigint;
  minRentMultiplier: bigint;
};

/* -------------------------------------------------------------------------- */
/*                                  Subgraph                                  */
/* -------------------------------------------------------------------------- */

export type SubgraphProtocolState = {
  hookFeesModifier: string;
  currentK: string;
  pendingK: string;
  activeBlock: string;
};

export type SubgraphPool = {
  id: string;
  bunniHub: {
    id: string;
  };
  bunniToken: {
    id: string;
  };
  currency0: {
    id: string;
  };
  currency1: {
    id: string;
  };
  fee: string;
  tickSpacing: string;
  hooks: string;
};

export type SubgraphTopPool = {
  id: string;
  bunniToken: {
    rawBalance0: string;
    rawBalance1: string;
    reserve0: string;
    reserve1: string;
    vault0: {
      id: string;
      decimals: string;
      pricePerVaultShare: string;
    } | null;
    vault1: {
      id: string;
      decimals: string;
      pricePerVaultShare: string;
    } | null;
  };
  currency0: {
    id: string;
    decimals: string;
    price: string;
  };
  currency1: {
    id: string;
    decimals: string;
    price: string;
  };
  priceCurrency0: string;
  priceCurrency1: string;
};

export type SubgraphTopPoolForPair = {
  id: string;
  currency0: {
    id: string;
  };
  currency1: {
    id: string;
  };
  fee: string;
  tickSpacing: string;
  hooks: string;
};
