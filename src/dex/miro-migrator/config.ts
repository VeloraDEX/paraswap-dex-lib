import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const MiroMigratorConfig: DexConfigMap<DexParams> = {
  MiroMigrator: {
    [Network.MAINNET]: {
      migratorAddress: '0xA10fA49197D1b9a48d7e06335D762733427e8fB9',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xcAfE001067cDEF266AfB7Eb5A286dCFD277f3dE5',
      sePsp1TokenAddress: '0x716fBC68E0c761684D9280484243FF094CC5FfAB',
    },
    [Network.OPTIMISM]: {
      migratorAddress: '0xDE191e579bD718a81de99df45884440c3Df6b4f9',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xd3594E879B358F430E20F82bea61e83562d49D48',
      sePsp1TokenAddress: '0x8C934b7dBc782568d14ceaBbEAeDF37cB6348615',
    },
  },
};
