import { BufferState, GyroECLPImmutable } from '@balancer-labs/balancer-maths';
import { Address } from '../../types';
import { HookConfig } from './hooks/balancer-hook-event-subscriber';
import { QauntAMMPoolState } from './quantAMMPool';
import { ReClammPoolState } from './reClammPool';

// Immutable data types available on all pools (Available from API)
export type CommonImmutablePoolState = {
  poolAddress: string;
  poolType: string;
  // For boosted pools tokens is the actual pool token wrapped, e.g. aUSDC/aDAI
  tokens: string[];
  // For boosted pools underlying is the unwrapped token, e.g. USDC/DAI
  tokensUnderlying: (string | null)[];
  weights: bigint[];
  // TODO re-introduce this once added to API
  // scalingFactors: bigint[];
  hookAddress: string | undefined;
  hookType: string | undefined;
  supportsUnbalancedLiquidity: boolean;
} & GyroECLPImmutable;

// Mutable data types available on all pools (Available via onchain calls/events)
export interface CommonMutableState {
  tokenRates: bigint[];
  erc4626Rates: (bigint | null)[];
  erc4626MaxDeposit: (bigint | null)[];
  erc4626MaxMint: (bigint | null)[];
  balancesLiveScaled18: bigint[];
  swapFee: bigint;
  aggregateSwapFee: bigint;
  totalSupply: bigint;
  isPoolPaused: boolean;
  // TODO remove this once API provides it
  scalingFactors: bigint[];
}

export type CommonPoolState = CommonImmutablePoolState & CommonMutableState;

export type PoolState =
  | CommonPoolState
  | (CommonPoolState & StableMutableState)
  | QauntAMMPoolState
  | ReClammPoolState;

// Stable Pool specific mutable data
export interface StableMutableState {
  amp: bigint;
  ampIsUpdating: boolean;
  ampStartValue: bigint;
  ampEndValue: bigint;
  ampStartTime: bigint;
  ampStopTime: bigint;
}

export type PoolStateMap = {
  [address: string]: PoolState;
};

export type ImmutablePoolStateMap = {
  [address: string]: CommonImmutablePoolState;
};

export type Step = {
  pool: Address;
  isBuffer: boolean;
  swapInput: {
    tokenIn: Address;
    tokenOut: Address;
  };
  poolState: PoolState | BufferState;
};

export type BalancerV3Data = {
  steps: Step[];
};

export type DexParams = {
  // Used to map network > API Name, e.g. 11155111>SEPOLIA
  apiNetworkName: string;
  vaultAddress: string;
  // This router handles single swaps
  // https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/interfaces/contracts/vault/IRouter.sol
  balancerRouterAddress: string;
  balancerBatchRouterAddress: string;
  hooks?: HookConfig[];
  quantAmmUpdateWeightRunnerAddress?: string;
};

export type TokenInfo = {
  isBoosted: boolean;
  underlyingToken: string | null;
  mainToken: string;
  index: number;
  rate: bigint;
  maxDeposit: bigint;
  maxMint: bigint;
};
