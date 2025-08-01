import { Address } from '../../types';

// DexKey structure from Solidity
export type DexKey = {
  token0: Address;
  token1: Address;
  salt: string; // bytes32 in Solidity
};

// Storage variables for a single DEX pool
export type PoolState = {
  // The main dex variables packed into a single uint256
  dexVariables: bigint;
  // Center price shift variables
  centerPriceShift: bigint;
  // Range shift variables
  rangeShift: bigint;
  // Threshold shift variables
  thresholdShift: bigint;
  // Last interaction timestamp for rebalancing calculations
  lastInteractionTimestamp: bigint;
};

// Unpacked dex variables for easier access during calculations
export type UnpackedDexVariables = {
  fee: bigint;
  revenueCut: bigint;
  rebalancingStatus: bigint;
  centerPriceShiftActive: boolean;
  centerPrice: bigint;
  centerPriceContractAddress: bigint;
  rangePercentShiftActive: boolean;
  upperPercent: bigint;
  lowerPercent: bigint;
  thresholdPercentShiftActive: boolean;
  upperShiftThresholdPercent: bigint;
  lowerShiftThresholdPercent: bigint;
  token0Decimals: bigint;
  token1Decimals: bigint;
  token0TotalSupplyAdjusted: bigint;
  token1TotalSupplyAdjusted: bigint;
};

// Data returned for transactions
export type FluidDexLiteData = {
  exchange: Address; // FluidDexLite contract address
  dexKey: DexKey; // The dex key for this pool
  swap0To1: boolean; // Direction of swap
};

// Pool parameters for a specific dex pool
export type PoolParams = {
  dexId: string; // bytes8 as hex string
  dexKey: DexKey;
};

export type DexParams = {
  dexLiteAddress: Address; // FluidDexLite contract address
  // Add any additional configuration parameters needed
};

// Constants for bit manipulation (from DexLiteSlotsLink and constantVariables)
export const BITS_DEX_LITE_DEX_VARIABLES_FEE = 0;
export const BITS_DEX_LITE_DEX_VARIABLES_REVENUE_CUT = 13;
export const BITS_DEX_LITE_DEX_VARIABLES_REBALANCING_STATUS = 20;
export const BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE_SHIFT_ACTIVE = 22;
export const BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE = 23;
export const BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE_CONTRACT_ADDRESS = 63;
export const BITS_DEX_LITE_DEX_VARIABLES_RANGE_PERCENT_SHIFT_ACTIVE = 82;
export const BITS_DEX_LITE_DEX_VARIABLES_UPPER_PERCENT = 83;
export const BITS_DEX_LITE_DEX_VARIABLES_LOWER_PERCENT = 97;
export const BITS_DEX_LITE_DEX_VARIABLES_THRESHOLD_PERCENT_SHIFT_ACTIVE = 111;
export const BITS_DEX_LITE_DEX_VARIABLES_UPPER_SHIFT_THRESHOLD_PERCENT = 112;
export const BITS_DEX_LITE_DEX_VARIABLES_LOWER_SHIFT_THRESHOLD_PERCENT = 119;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_DECIMALS = 126;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_DECIMALS = 131;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_TOTAL_SUPPLY_ADJUSTED = 136;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_TOTAL_SUPPLY_ADJUSTED = 196;

// Bit masks (from constantVariables.sol)
export const X1 = 0x1n;
export const X2 = 0x3n;
export const X5 = 0x1fn;
export const X7 = 0x7fn;
export const X13 = 0x1fffn;
export const X14 = 0x3fffn;
export const X19 = 0x7ffffn;
export const X20 = 0xfffffn;
export const X24 = 0xffffffn;
export const X28 = 0xfffffffn;
export const X33 = 0x1ffffffffn;
export const X40 = 0xffffffffffn;
export const X60 = 0xfffffffffffffffn;
export const X64 = 0xffffffffffffffffn;
export const X73 = 0x1ffffffffffffffffffn;

// CenterPriceShift bit positions
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP = 0;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_SHIFTING_TIME = 33;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_MAX_CENTER_PRICE = 57;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_MIN_CENTER_PRICE = 85;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_PERCENT = 113;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_TIME_TO_SHIFT = 133;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_TIMESTAMP = 153;

// RangeShift bit positions
export const BITS_DEX_LITE_RANGE_SHIFT_OLD_UPPER_RANGE_PERCENT = 0;
export const BITS_DEX_LITE_RANGE_SHIFT_OLD_LOWER_RANGE_PERCENT = 14;
export const BITS_DEX_LITE_RANGE_SHIFT_TIME_TO_SHIFT = 28;
export const BITS_DEX_LITE_RANGE_SHIFT_TIMESTAMP = 48;

// ThresholdShift bit positions
export const BITS_DEX_LITE_THRESHOLD_SHIFT_OLD_UPPER_THRESHOLD_PERCENT = 0;
export const BITS_DEX_LITE_THRESHOLD_SHIFT_OLD_LOWER_THRESHOLD_PERCENT = 7;
export const BITS_DEX_LITE_THRESHOLD_SHIFT_TIME_TO_SHIFT = 14;
export const BITS_DEX_LITE_THRESHOLD_SHIFT_TIMESTAMP = 34;

// Other constants
export const TWO_DECIMALS = 100n;
export const FOUR_DECIMALS = 10000n;
export const SIX_DECIMALS = 1000000n;
export const PRICE_PRECISION = 10n ** 27n;
export const TOKENS_DECIMALS_PRECISION = 9n;
export const MINIMUM_LIQUIDITY_SWAP = 10000n;
export const DEFAULT_EXPONENT_SIZE = 8n;
export const DEFAULT_EXPONENT_MASK = 0xffn;

// Result interfaces for math calculations
export interface SwapResult {
  amountOut: bigint;
  amountIn: bigint;
}

export interface PricingResult {
  centerPrice: bigint;
  upperRangePrice: bigint;
  lowerRangePrice: bigint;
  token0ImaginaryReserves: bigint;
  token1ImaginaryReserves: bigint;
}
