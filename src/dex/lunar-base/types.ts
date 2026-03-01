import { Address } from '../../types';

export interface BaseFeeConfig {
  baseFee: number;
  wToken0: number;
  wToken1: number;
}

export interface LunarBaseApiPoolBackend {
  id: string;
  pair_address: string;
  factory_address: string;
  token0_address: string;
  token0_symbol: string;
  token0_name: string;
  token0_decimals: number | null;
  token1_address: string;
  token1_symbol: string;
  token1_name: string;
  token1_decimals: number | null;
  base_fee_bps: number;
  w_token0_in: string;
  w_token1_in: string;
  tvl: string;
  reserve0: string;
  reserve1: string;
}

export interface LunarBaseApiPoolInfo {
  backend: LunarBaseApiPoolBackend;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  feeConfig: {
    baseFeeBps: number;
    wToken0In: string;
    wToken1In: string;
  };
}

export interface LunarBaseApiTokenPair {
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  pools: LunarBaseApiPoolInfo[];
}

export interface LunarBaseApiResponse {
  pools: LunarBaseApiTokenPair[];
}

export interface LunarBasePoolState {
  reserves0: string;
  reserves1: string;
  feeCode: number;
  baseFeeConfig: BaseFeeConfig;
}

export interface LunarBasePair {
  token0: { address: Address; decimals: number };
  token1: { address: Address; decimals: number };
  exchange?: Address;
  pool?: any;
  baseFeeConfig?: BaseFeeConfig;
  userModule?: Address;
  moduleMask?: number;
  hasNativeToken0?: boolean;
  hasNativeToken1?: boolean;
}

export interface LunarBaseData {
  router: Address;
  pools: LunarBasePool[];
  weth?: Address;
}

export interface LunarBasePool {
  address: Address;
  direction: boolean;
  fee: number;
  baseFeeConfig: BaseFeeConfig;
  userModule: Address;
  moduleMask: number;
  reservesIn: string;
  reservesOut: string;
  dynamicFeeQuote?: LunarFeeQuote;
  isNativeInput?: boolean;
  isNativeOutput?: boolean;
}

export interface LunarBasePoolOrderedParams {
  tokenIn: string;
  tokenOut: string;
  reservesIn: string;
  reservesOut: string;
  fee: string;
  direction: boolean;
  exchange: string;
  baseFeeConfig: BaseFeeConfig;
  userModule: Address;
  moduleMask: number;
}

export interface LunarFeeQuote {
  inBps: number;
  outBps: number;
  protocolShareBps: number;
}

export interface LunarBaseDexParams {
  factoryAddress: Address;
  routerAddress: Address;
  quoterAddress?: Address;
  coreModuleAddress?: Address;
  apiURL?: string;
  subgraphURL?: string;
  poolGasCost?: number;
  defaultBaseFee?: number;
}

export const LUNAR_BASE_FEE_DENOMINATOR = 1_000_000_000;
export const LUNAR_BASE_WEIGHT_SUM = 1_000_000_000;
export const LUNAR_BASE_DEFAULT_MODULE_MASK = 1;
export const LUNAR_BASE_ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000';

export const LUNAR_BASE_DEFAULT_FEE_CONFIG: BaseFeeConfig = {
  baseFee: 3_000_000,
  wToken0: 500_000_000,
  wToken1: 500_000_000,
};

export function calculateEffectiveFee(
  config: BaseFeeConfig,
  isToken0In: boolean,
): number {
  const weight = BigInt(isToken0In ? config.wToken0 : config.wToken1);
  const baseFee = BigInt(config.baseFee);
  const weightSum = BigInt(LUNAR_BASE_WEIGHT_SUM);
  return Number((baseFee * weight) / weightSum);
}

export function apiBpsToFeeCode(bps: number): number {
  return bps * 10000;
}

export function apiWeightToInternal(weight: string): number {
  const API_WEIGHT_DENOMINATOR = BigInt('100000000000000000000000');
  const w = BigInt(weight);
  return Number((w * BigInt(LUNAR_BASE_WEIGHT_SUM)) / API_WEIGHT_DENOMINATOR);
}
