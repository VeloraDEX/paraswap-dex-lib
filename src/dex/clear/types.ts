import { Address } from '../../types';

export type ClearData = {
  vault: Address;
  router: Address;
};

export interface DexParams {
  factoryAddress: Address;
  swapAddress: Address;
  poolGasCost?: number;
}

export interface ClearVaultToken {
  id: string;
  address: string;
  symbol: string;
  decimals: string;
}

export interface ClearVault {
  id: string;
  address: string;
  tokens: ClearVaultToken[];
  totalAssets?: bigint;
}

export interface PreviewSwapCallInfo {
  vaultAddress: string;
  poolIdentifier: string;
  isUnit: boolean;
  amountIndex: number;
}
