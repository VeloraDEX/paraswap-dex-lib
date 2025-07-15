import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const StaderConfig: DexConfigMap<DexParams> = {
  Stader: {
    [Network.MAINNET]: {
      ETHx: '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b',
      SSPM: '0xcf5EA1b38380f6aF39068375516Daf40Ed70D299',
      StaderOracle: '0xF64bAe65f6f2a5277571143A24FaaFDFC0C2a737',
    },
  },
};
