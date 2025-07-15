import { Network } from '../../constants';
import { DexConfigMap } from '../../types';

export const CablesConfig: DexConfigMap<{ mainnetRFQAddress: string }> = {
  Cables: {
    [Network.AVALANCHE]: {
      mainnetRFQAddress: '0xfA12DCB2e1FD72bD92E8255Db6A781b2c76adC20',
    },
    [Network.ARBITRUM]: {
      mainnetRFQAddress: '0xfA12DCB2e1FD72bD92E8255Db6A781b2c76adC20',
    },
  },
};
