import { BufferState, GyroECLPImmutable } from '@balancer-labs/balancer-maths';
import { Address } from '../../types';
import { HookConfig } from './hooks/balancer-hook-event-subscriber';
import { QauntAMMPoolState } from './quantAMMPool';
import { ReClammPoolState } from './reClammPool';

// Interface for multicall data
export interface callData {
  target: string;
  callData: string;
}

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
  version: number;
} & GyroECLPImmutable;

// Mutable data types available on all pools (Available via onchain calls/events)
export interface CommonMutableState {
  tokenRates: bigint[];
  erc4626Rates: (bigint | null)[];
  erc4626MaxDeposit: (bigint | null)[];
  erc4626MaxMint: (bigint | null)[];
  erc4626MaxWithdraw: (bigint | null)[];
  erc4626MaxRedeem: (bigint | null)[];
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

// Buffer state extended with ERC4626 unwrap limits. The underlying maths
// package (BufferState) doesn't model maxWithdraw/maxRedeem; we check them
// ourselves in getSwapResult so unwrap amounts that would revert on-chain
// produce a 0 price instead.
export type BufferStateExt = BufferState & {
  maxWithdraw: bigint;
  maxRedeem: bigint;
};

export type Step = {
  pool: Address;
  isBuffer: boolean;
  swapInput: {
    tokenIn: Address;
    tokenOut: Address;
  };
  poolState: PoolState | BufferStateExt;
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
  maxWithdraw: bigint;
  maxRedeem: bigint;
};
