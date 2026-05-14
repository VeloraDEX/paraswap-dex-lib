import type { Address, TxObject } from '../../types';
import type { DepositWithdrawReturn } from '../../dex/weth/types';
import type { Executors } from '../../executor/types';
import type { ContractMethodV6, SwapSide } from '@paraswap/core';
import type { ResolvedLeg, RoutePlan } from '../../executor/encoding-types';
export type {
  OrderedExecutorLeg,
  ResolvedLeg,
  RoutePlan,
  RoutePlanExchange,
  RoutePlanRoute,
  RoutePlanSwap,
  RoutePlanSwapExchange,
  RoutePosition,
} from '../../executor/encoding-types';

export type GasInput = {
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

export type FeeInput = {
  partnerAddress: Address;
  partnerFeePercent: string;
  referrerAddress?: Address;
  takeSurplus: boolean;
  isCapSurplus: boolean;
  isSurplusToUser: boolean;
  isDirectFeeTransfer: boolean;
  isSkipBlacklist?: boolean;
};

export type BuildInput = {
  routePlan: RoutePlan;
  resolvedLegs: ResolvedLeg[];
  wethPlan?: DepositWithdrawReturn;
  executorType: Executors;
  executorAddress: Address;
  augustusV6Address: Address;
  wrappedNativeTokenAddress: Address;
  network: number;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  minMaxAmount: string;
  quotedAmount: string;
  side: SwapSide;
  contractMethod: ContractMethodV6;
  blockNumber: number;
  userAddress: Address;
  beneficiary: Address;
  permit: string;
  uuid: string;
  fee: FeeInput;
  gas?: GasInput;
};

export type ResolvedDirectCall = {
  contractMethod: ContractMethodV6;
  params: unknown[];
};

export type DirectBuildInput = ResolvedDirectCall & {
  userAddress: Address;
  augustusV6Address: Address;
  srcToken: Address;
  srcAmount: string;
  minMaxAmount: string;
  side: SwapSide;
  gas?: GasInput;
};

export type ResolvedBuildOutput = {
  params: (string | string[])[];
  txObject: TxObject;
};

export type ResolvedDirectBuildOutput = ResolvedDirectCall & {
  txObject: TxObject;
};

export type BuildOutput = ResolvedBuildOutput;
