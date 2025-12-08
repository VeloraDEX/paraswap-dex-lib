import { Address } from '../../types';

export type ClearData = {
  vault: Address;
  router: Address;
};

export interface DexParams {
  subgraphURL?: string;
  factoryAddress: Address;
  swapAddress: Address;
  oracleAddress: Address;
  accessManagerAddress?: Address;
  poolGasCost?: number;
  feeCode: number;
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
}

export interface PreviewSwapCallInfo {
  vaultAddress: string;
  poolIdentifier: string;
  isUnit: boolean;
  amountIndex: number;
}
