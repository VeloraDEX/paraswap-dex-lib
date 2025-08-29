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
