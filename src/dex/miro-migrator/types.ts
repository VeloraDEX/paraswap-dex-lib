import { Address } from '../../types';

export type PoolState = {
  balance: bigint;
};

export type MiroMigratorData = null;

export type DexParams = {
  migratorAddress: Address;
  vlrTokenAddress: Address;
  pspTokenAddress: Address;
  sePsp1TokenAddress: Address;
};

export enum MiroMigratorFunctions {
  migratePSPtoVLR = 'migratePSPtoVLR',
  migrateSePSP1toVLR = 'migrateSePSP1toVLR',
}
