import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const YoConfig: DexConfigMap<DexParams> = {
  yoETH: {
    [Network.BASE]: {
      vault: '0x3a43aec53490cb9fa922847385d82fe25d0e9de7',
      asset: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    },
  },
  yoUSD: {
    [Network.BASE]: {
      vault: '0x0000000f2eb9f69274678c76222b35eec7588a65',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
    },
  },
};
