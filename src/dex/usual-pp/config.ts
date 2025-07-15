import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const Config: DexConfigMap<DexParams> = {
  UsualPP: {
    [Network.MAINNET]: {
      USD0: {
        address: '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5',
        decimals: 18,
      },
      USD0PP: {
        address: '0x35d8949372d46b7a3d5a56006ae77b215fc69bc0',
        decimals: 18,
      },
    },
  },
};
