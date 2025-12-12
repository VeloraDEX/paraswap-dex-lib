import { OptimalRate, OptimalSwap, OptimalSwapExchange } from '@paraswap/core';
import { DexExchangeBuildParam } from '../types';

export enum Flag {
  SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP = 18, // // (flag 18 mod 4) = case 2: sendEth equal to fromAmount + insert fromAmount, (flag 18 mod 3) = case 0: don't check balance after swap
  SEND_ETH_EQUAL_TO_FROM_AMOUNT_PLUS_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP = 14, // (flag 14 mod 4) = case 2: sendEth equal to fromAmount + insert fromAmount, (flag 14 mod 3) = case 2: case 2: check "srcToken" balance after swap
  INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP = 11, // (flag 11 mod 4) = case 3: insert fromAmount, (flag 11 mod 3) = case 2: check "srcToken" balance after swap
  SEND_ETH_EQUAL_TO_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP = 9, // (flag 9 mod 4) = case 1: sendEth equal to fromAmount, (flag 9 mod 3) = case 0: don't check balance after swap
  DONT_INSERT_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP = 8, // (flag 8 mod 4) = case 0: don't insert fromAmount, (flag 8 mod 3) = case 2: check "srcToken" balance after swap
  INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP = 7, // (flag 7 mod 4) = case 3: insert fromAmount, (flag 7 mod 3) = case 1: check eth balance after swap
  SEND_ETH_EQUAL_TO_FROM_AMOUNT_CHECK_SRC_TOKEN_BALANCE_AFTER_SWAP = 5, // (flag 5 mod 4) = case 1: sendEth equal to fromAmount, (flag 5 mod 3) = case 2: check "srcToken" balance after swap
  DONT_INSERT_FROM_AMOUNT_CHECK_ETH_BALANCE_AFTER_SWAP = 4, // (flag 4 mod 4) = case 0: don't insert fromAmount, (flag 4 mod 3) = case 1: check eth balance after swap
  INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP = 3, // (flag 3 mod 4) = case 3: insert fromAmount, (flag 3 mod 3) = case 0: don't check balance after swap
  DONT_INSERT_FROM_AMOUNT_DONT_CHECK_BALANCE_AFTER_SWAP = 0, // (flag 0 mod 4) = case 0: don't insert fromAmount, (flag 0 mod 3) = case 0: don't check balance after swap
  DEFAULT = -1,
}

export enum SpecialDex {
  DEFAULT = 0,
  SWAP_ON_SWAAP_V2_SINGLE = 1, // swapOnSwaapV2Single
  // SWAP_ON_SWAAP_V2 = 3, // swapOnSwaapV2
  SWAP_ON_BALANCER_V1 = 2, // swapOnBalancerV1
  SWAP_ON_MAKER_PSM = 3, // swapOnMakerPSM
  SEND_NATIVE = 4, // sendNative
  SWAP_ON_BALANCER_V2 = 5, // swapOnBalancerV2
  SWAP_ON_UNISWAP_V2_FORK = 6,
  SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK = 7,
  SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK_WITH_FEE = 8,
  SWAP_ON_AUGUSTUS_RFQ = 9, // swapOnAugustusRFQ
  EXECUTE_VERTICAL_BRANCHING = 10, // execute vertical branching
  BUY_ON_SOLIDLY_V3 = 11,
  SWAP_ON_DEXALOT = 12,
  SWAP_ON_HASHFLOW = 13,
}

export enum Executors {
  WETH = 'WETH',
  ONE = 'Executor01',
  TWO = 'Executor02',
  THREE = 'Executor03',
}

export enum RouteExecutionType {
  SINGLE_STEP = 0, // simpleSwap with 100% on a path and single DEX
  HORIZONTAL_SEQUENCE = 1, // multiSwap with 100% on each path
  VERTICAL_BRANCH = 3, // simpleSwap with N DEXs on a path
  VERTICAL_BRANCH_HORIZONTAL_SEQUENCE = 4, // multiSwap, megaSwap
  NESTED_VERTICAL_BRANCH_HORIZONTAL_SEQUENCE = 5, // megaSwap
}

export type SingleRouteBuildSwaps<TSwap> = {
  type: 'single-route';
  percent: number;
  swaps: TSwap[];
};

export type MultiRouteBuildSwaps<TSwap> = {
  type: 'multi-route';
  percent: number;
  swaps: (TSwap[] | TSwap[][])[];
};

export type GenericRouteSwaps<TSwap> =
  | SingleRouteBuildSwaps<TSwap>
  | MultiRouteBuildSwaps<TSwap>;

export type RouteSwaps = GenericRouteSwaps<OptimalSwap>;
export type RouteBuildSwaps = GenericRouteSwaps<BuildSwap>;

export type BuildSwapExchange<T> = OptimalSwapExchange<T> & {
  build: {
    dexParams: DexExchangeBuildParam;
    wethDeposit: bigint;
    wethWithdraw: bigint;
    dexFlag: Flag;
    approveFlag: Flag;
  };
};

export type BuildSwap = Omit<OptimalSwap, 'swapExchanges'> & {
  swapExchanges: BuildSwapExchange<any>[];
};
