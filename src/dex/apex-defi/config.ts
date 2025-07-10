import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ApexDefiConfig: DexConfigMap<DexParams> = {
  ApexDefi: {
    [Network.AVALANCHE]: {
      factoryAddress: '0x754A0c42C35562eE7a41eb824d14bc1259820f01',
      routerAddress: '0x5d2dDA02280F55A9D4529eadFA45Ff032928082B',
    },
  },
};
