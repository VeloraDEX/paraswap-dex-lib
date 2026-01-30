import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ClearConfig: DexConfigMap<DexParams> = {
  clear: {
    [Network.MAINNET]: {
      factoryAddress: '0x8bF266ED803e474AE7Bf09ADB5ba2566c489223d',
      swapAddress: '0xeb5AD3D93E59eFcbC6934caD2B48EB33BAf29745',
      poolGasCost: 150_000,
    },
  },
};
