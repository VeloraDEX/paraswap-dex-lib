import { Address, Token } from '../../types';

export type ClearData = {
  vault: Address;
};

export interface DexParams {
  factoryAddress: Address;
  swapAddress: Address;
  poolGasCost?: number;
}

export type PoolState = {
  address: Address;
  tokens: Address[];
}[];

export interface ClearVault {
  address: Address;
  tokens: Token[];
  tokenAssets: Record<string, bigint>;
}
