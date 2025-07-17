import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const MiroMigratorConfig: DexConfigMap<DexParams> = {
  MiroMigrator: {
    [Network.MAINNET]: {
      migratorAddress: '0x4aBD869acbF927048434d137A3331D006Db54416',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xcAfE001067cDEF266AfB7Eb5A286dCFD277f3dE5',
      sePsp1TokenAddress: '0x716fBC68E0c761684D9280484243FF094CC5FfAB',
    },
    [Network.OPTIMISM]: {
      migratorAddress: '0xb6208dE484dFb4Fd54148b1B9a745E9dF29519Ee',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xd3594E879B358F430E20F82bea61e83562d49D48',
      sePsp1TokenAddress: '0x8C934b7dBc782568d14ceaBbEAeDF37cB6348615',
    },
  },
};
