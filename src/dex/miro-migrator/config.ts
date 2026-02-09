import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const MiroMigratorConfig: DexConfigMap<DexParams> = {
  MiroMigrator: {
    [Network.MAINNET]: {
      migratorAddress: '0x311bca70b6cd9f320a68a63b2331d7a3ca55bde7',
      vlrTokenAddress: '0x4e107a0000db66f0e9fd2039288bf811dd1f9c74',
      pspTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      sePsp1TokenAddress: '0x716fbc68e0c761684d9280484243ff094cc5ffab',
    },
    [Network.OPTIMISM]: {
      migratorAddress: '0x3f06aa8fff196f9d5033553ca035aa09fae6492c',
      vlrTokenAddress: '0x4e107a0000db66f0e9fd2039288bf811dd1f9c74',
      pspTokenAddress: '0xd3594e879b358f430e20f82bea61e83562d49d48',
      sePsp1TokenAddress: '0x8c934b7dbc782568d14ceabbeaedf37cb6348615',
    },
    [Network.BSC]: {
      migratorAddress: '0xd6a861bd2f8eed343b8ccdb977de1d106c72f557',
      vlrTokenAddress: '0x4e107a0000db66f0e9fd2039288bf811dd1f9c74',
      pspTokenAddress: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      sePsp1TokenAddress: '',
    },
  },
};
