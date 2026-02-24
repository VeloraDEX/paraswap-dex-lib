import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ClearConfig: DexConfigMap<DexParams> = {
  Clear: {
    [Network.MAINNET]: {
      factoryAddress: '0x78aba0729345219B8Ec4D5c9c19D23186E0803fB',
      swapAddress: '0x07656EA4898760d55feA211015df247b44B9D81b',
      poolGasCost: 150_000,
    },
  },
};
