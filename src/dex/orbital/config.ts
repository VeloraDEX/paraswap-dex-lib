import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const OrbitalConfig: DexConfigMap<DexParams> = {
  Orbital: {
    [Network.POLYGON]: {
      factory: '0x143788B337452a466A154236F5128299B821670B',
    },
  },
};
