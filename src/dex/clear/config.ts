import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ClearConfig: DexConfigMap<DexParams> = {
  Clear: {
    [Network.MAINNET]: {
      factoryAddress: '0x78aba0729345219B8Ec4D5c9c19D23186E0803fB',
      swapAddress: '0x35e22BcC2c60c8a721cb36cE47ad562860A2D9CB',
      poolGasCost: 150_000,
    },
  },
};
