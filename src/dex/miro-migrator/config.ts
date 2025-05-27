import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const MiroMigratorConfig: DexConfigMap<DexParams> = {
  MiroMigrator: {
    [Network.OPTIMISM]: {
      migratorAddress: '0x5032433fb65d7db8e8b90cb239d50fdfd941fb6b',
      pspTokenAddress: '0x326aec8d7d99d1d6022c57c5f6194d2a7867227d',
      xyzTokenAddress: '0xa2781111f824ca1cd98454b2c9722baefc898e99',
    },
  },
};
