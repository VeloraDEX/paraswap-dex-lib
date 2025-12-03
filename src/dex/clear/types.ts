import { Address } from '../../types';

/**
 * Adapter configuration for a specific swap side
 */
export interface Adapter {
  name: string;
  index: number;
}

/**
 * Clear swap data passed to Augustus
 */
export type ClearData = {
  vault: Address; // Address of the Clear vault
  router: Address; // Address of ClearSwap contract
};

/**
 * Clear DEX configuration parameters
 */
export interface DexParams {
  subgraphURL?: string; // GraphQL endpoint for the Squid indexer
  factoryAddress: Address; // ClearFactory - manages vaults
  swapAddress: Address; // ClearSwap - executes swaps
  oracleAddress: Address; // ClearOracle - provides pricing
  accessManagerAddress?: Address; // ClearAccessManager - manages permissions
  poolGasCost?: number; // Estimated gas cost for a swap
  feeCode: number; // Fee in basis points (if any)
}
