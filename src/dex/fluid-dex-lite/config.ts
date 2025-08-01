import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const FluidDexLiteConfig: DexConfigMap<DexParams> = {
  FluidDexLite: {
    [Network.MAINNET]: {
      dexLiteAddress: '0xBbcb91440523216e2b87052A99F69c604A7b6e00',
    },
  },
};
