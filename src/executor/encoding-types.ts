import type { DepositWithdrawReturn } from '../dex/weth/types';
import type { Address, DexExchangeBuildParam } from '../types';
import type { Executors } from './types';

export type ExecutorEncodingLogger = {
  debug: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
};

export type ExecutorEncodingContext = {
  network: number;
  augustusV6Address: Address;
  wrappedNativeTokenAddress: Address;
  executorsAddresses: Record<Executors, Address>;
  isWETH: (address: Address) => boolean;
  logger: ExecutorEncodingLogger;
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

export type RoutePlanExchange = RoutePosition & {
  route: RoutePlanRoute;
  swap: RoutePlanSwap;
  swapExchange: RoutePlanSwapExchange;
};

export type OrderedExecutorLeg = RoutePlanExchange & {
  resolvedLeg: ResolvedLeg;
};

export type ExecutorBytecodeBuildInput = {
  routePlan: RoutePlan;
  resolvedLegs: ResolvedLeg[];
  sender: Address;
  srcToken: Address;
  destToken: Address;
  destAmount: string;
  wethPlan?: DepositWithdrawReturn;
};
