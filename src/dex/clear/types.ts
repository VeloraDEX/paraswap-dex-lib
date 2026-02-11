import { Address } from '../../types';

export type ClearData = {
  vault: Address;
};

export interface DexParams {
  factoryAddress: Address;
  swapAddress: Address;
  poolGasCost?: number;
}

export interface ClearVaultToken {
  address: string;
  decimals?: number;
}

export interface ClearVault {
  address: string;
  tokens: ClearVaultToken[];
  totalAssets?: bigint;
}
