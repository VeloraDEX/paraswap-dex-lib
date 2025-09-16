import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const MiroMigratorConfig: DexConfigMap<DexParams> = {
  MiroMigrator: {
    [Network.MAINNET]: {
      migratorAddress: '0x4Bb41A327c65BCD00F2f119ef4328199f2c8aFF8',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xcAfE001067cDEF266AfB7Eb5A286dCFD277f3dE5',
      sePsp1TokenAddress: '0x716fBC68E0c761684D9280484243FF094CC5FfAB',
    },
    [Network.OPTIMISM]: {
      migratorAddress: '0x57F0981F4bF69f4dA4f3c6082A4C93D025c97E4E',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xd3594E879B358F430E20F82bea61e83562d49D48',
      sePsp1TokenAddress: '0x8C934b7dBc782568d14ceaBbEAeDF37cB6348615',
    },
    [Network.BSC]: {
      migratorAddress: '0xD6a861BD2F8eeD343b8CCDb977DE1d106c72F557',
      vlrTokenAddress: '0x4e107a0000DB66f0E9Fd2039288Bf811dD1f9c74',
      pspTokenAddress: '0xcAfE001067cDEF266AfB7Eb5A286dCFD277f3dE5',
      sePsp1TokenAddress: '',
    },
  },
};
