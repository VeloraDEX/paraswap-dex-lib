import { Address, Token } from '../../types';

export type ClearData = {
  vault: Address;
};

export interface DexParams {
  factoryAddress: Address;
  swapAddress: Address;
  oracleAddress: Address;
  poolGasCost?: number;
}

export enum OracleAdapterType {
  CUSTOM = 0,
  CHAINLINK = 1,
}

export type AssetOracleState = {
  enabled: boolean;
  assetDecimals: number;
  oracleDecimals: number;
  redemptionPrice: bigint;
  price: bigint;
  priceTTL: bigint;
  lastUpdateTimestamp: bigint;
  adapterType: OracleAdapterType;
  adapter: Address;
};

export type ClearProtocolState = {
  swap: {
    depegThresholdBps: bigint;
    maximalDepegThresholdBps: bigint;
    paused: boolean;
  };
  oracles: { [asset: string]: AssetOracleState };
};

export type VaultTokenState = {
  enabled: boolean;
  decimals: number;
  iou: Address;
  iouCurveMetaPool: Address;
  tokensCurvePoolIndex: bigint;
  adapter: Address;
  maxExposureBps: bigint;
  desiredExposureBps: bigint;
  emitedIou: bigint;
  cachedAssets: bigint;
};

export type ClearVaultState = {
  address: Address;
  curvePlainPool: Address;
  iouLpFeeBps: bigint;
  iouTreasuryFeeBps: bigint;
  // Snapshot of `totalSupply * index / 10000`, the contract's exposure denominator.
  // Refreshed by deposits/withdraws/rebalances; unchanged by swaps (swap doesn't refreshIndex).
  exposureDenominator: bigint;
  tokens: { [token: string]: VaultTokenState };
};

export type FactoryEntry = {
  address: Address;
  tokens: Address[];
  curvePlainPool: Address;
};

export type FactoryState = FactoryEntry[];

export type PoolState = FactoryState;

export interface ClearVault {
  address: Address;
  tokens: Token[];
  tokenAssets: Record<string, bigint>;
}
