import { NumberAsString } from '@paraswap/core';
import { Address } from '../../types';
import { DerivedGyroEParams, GyroEParams } from '@balancer-labs/sor';

// These should match the Balancer Pool types available on Subgraph
export enum BalancerPoolTypes {
  Weighted = 'Weighted',
  Stable = 'Stable',
  MetaStable = 'MetaStable',
  LiquidityBootstrapping = 'LiquidityBootstrapping',
  Investment = 'Investment',
  StablePhantom = 'StablePhantom',
  ComposableStable = 'ComposableStable',
  Linear = 'Linear',
  AaveLinear = 'AaveLinear',
  ERC4626Linear = 'ERC4626Linear',
  BeefyLinear = 'BeefyLinear',
  GearboxLinear = 'GearboxLinear',
  MidasLinear = 'MidasLinear',
  ReaperLinear = 'ReaperLinear',
  SiloLinear = 'SiloLinear',
  TetuLinear = 'TetuLinear',
  YearnLinear = 'YearnLinear',
  Gyro3 = 'Gyro3',
  GyroE = 'GyroE',
}

export type TokenState = {
  balance: bigint;
  scalingFactor?: bigint; // It includes the token priceRate
  weight?: bigint;
};

export type PoolState = {
  tokens: {
    [address: string]: TokenState;
  };
  tokenRates?: bigint[];
  rateProviders?: string[];
  gyroParams?: GyroEParams;
  gyroDerivedParams?: DerivedGyroEParams;
  swapFee: bigint;
  orderedTokens: string[];
  rate?: bigint;
  amp?: bigint;
  // Linear Pools
  mainIndex?: number;
  wrappedIndex?: number;
  bptIndex?: number;
  lowerTarget?: bigint;
  upperTarget?: bigint;
  actualSupply?: bigint;
};

export type SubgraphToken = {
  address: string;
  decimals: number;
};

export interface SubgraphMainToken extends SubgraphToken {
  poolToken: SubgraphToken;
  pathToToken: {
    poolId: string;
    poolAddress: string;
    token: SubgraphToken;
  }[];
  //used to flag tokens that inside of a nested composable stable this way we can avoid paths
  //through pools where the tokenIn and tokenOut are inside a nested pool
  //ie MAI / bbaUSD, where tokenIn is DAI and tokenOut is USDC
  isDeeplyNested: boolean;
}

export type SubgraphPoolAddressDictionary = {
  [address: string]: SubgraphPoolBase;
};

export interface SubgraphPoolBase {
  id: string;
  address: string;
  poolType: BalancerPoolTypes;
  poolTypeVersion: number;
  tokens: SubgraphToken[];
  tokensMap: { [tokenAddress: string]: SubgraphToken };
  mainIndex: number;
  wrappedIndex: number;

  mainTokens: SubgraphMainToken[];

  // gyro3
  root3Alpha: string;
  // gyroE
  alpha: string;
  beta: string;
  c: string;
  s: string;
  lambda: string;
  tauAlphaX: string;
  tauAlphaY: string;
  tauBetaX: string;
  tauBetaY: string;
  u: string;
  v: string;
  w: string;
  z: string;
  dSq: string;
}

export type BalancerSwapV2 = {
  poolId: string;
  amount: string;
};

export type OptimizedBalancerV2Data = {
  swaps: BalancerSwapV2[];
  isApproved?: boolean;
};

export type BalancerFunds = {
  sender: string;
  fromInternalBalance: boolean;
  recipient: string;
  toInternalBalance: boolean;
};

// Indexes represent the index of the asset assets array param
export type BalancerSwap = {
  poolId: string;
  assetInIndex: number;
  assetOutIndex: number;
  amount: string;
  userData: string;
};

export enum SwapTypes {
  SwapExactIn,
  SwapExactOut,
}

export type BalancerV2SingleSwap = {
  poolId: string;
  kind: SwapTypes;
  assetIn: string;
  assetOut: string;
  amount: string;
  userData: string;
};

export type BalancerV2SwapParam = [
  singleSwap: BalancerV2SingleSwap,
  funds: BalancerFunds,
  limit: string,
  deadline: string,
];

export type BalancerV2BatchSwapParam = [
  kind: SwapTypes,
  swaps: BalancerSwap[],
  assets: string[],
  funds: BalancerFunds,
  limits: string[],
  deadline: string,
];

export type BalancerV2DirectParam = [
  swaps: BalancerSwap[],
  assets: Address[],
  funds: BalancerFunds,
  limits: NumberAsString[],
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  expectedAmount: NumberAsString,
  deadline: NumberAsString,
  feePercent: NumberAsString,
  vault: Address,
  partner: Address,
  isApproved: boolean,
  beneficiary: Address,
  permit: string,
  uuid: string,
];

export type BalancerV2DirectParamV6 = [
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  quotedAmount: NumberAsString,
  metadata: string,
  beneficiaryAndApproveFlag: NumberAsString,
];

export type BalancerV2DirectParamV6Swap = [
  params: BalancerV2DirectParamV6,
  partnerAndFee: string,
  permit: string,
  balancerParams: string,
];

export type BalancerV2Data = {
  poolId: string;
};

export type FallbackPool = {
  id: string;
  address: string;
  poolType: BalancerPoolTypes;
  poolTypeVersion: number;
  tokens: SubgraphToken[];
  mainIndex: number;
  wrappedIndex: number;
};

export type DexParams = {
  subgraphURL: string;
  vaultAddress: Address;
};

export interface callData {
  target: string;
  callData: string;
}
export type PoolStateMap = { [address: string]: PoolState };

export interface PoolStateCache {
  blockNumber: number;
  poolState: PoolStateMap;
}
