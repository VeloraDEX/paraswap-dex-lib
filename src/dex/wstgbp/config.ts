import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const WstGBPConfig: DexConfigMap<DexParams> = {
  wstGBP: {
    [Network.MAINNET]: {
      adapterAddress: '0xBE402d34f31133B1Dc00277f24F8ce2d975CBe23',
      wstGBPAddress: '0x57C3571f10767E49C9d7b60feb6c67804783B7aE',
      tGBPAddress: '0x27f6c8289550fCE67f6B50BeD1F519966aFE5287',
    },
  },
};
