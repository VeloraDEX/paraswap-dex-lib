import type { Address, DexExchangeBuildParam, TxObject } from '../../types';
import type { DepositWithdrawReturn } from '../../dex/weth/types';
import type { Executors } from '../../executor/types';
import type { ContractMethodV6, SwapSide } from '@paraswap/core';

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

export type RoutePlan = {
  routes: RoutePlanRoute[];
};

export type RoutePlanRoute = {
  percent: number;
  swaps: RoutePlanSwap[];
};

export type RoutePlanSwap = {
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  swapExchanges: RoutePlanSwapExchange[];
};

export type RoutePlanSwapExchange = {
  exchange: string;
  percent: number;
  srcAmount: string;
  destAmount: string;
};

export type RoutePosition = {
  routeIndex: number;
  swapIndex: number;
  swapExchangeIndex: number;
};

export type ResolvedLeg = RoutePosition & {
  exchangeParam: DexExchangeBuildParam;
  normalizedSrcToken: Address;
  normalizedDestToken: Address;
  normalizedSrcAmount: string;
  normalizedDestAmount: string;
  recipient: Address;
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
