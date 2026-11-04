import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const StabullConfig: DexConfigMap<DexParams> = {
  Stabull: {
    [Network.MAINNET]: {
      factory: '0x2e9e34b5af24b66f12721113c1c8ffcbb7bc8051',
      deploymentBlock: 19773443,
    },
    [Network.POLYGON]: {
      factory: '0x3c60234db40e6e5b57504e401b1cdc79d91faf89',
      deploymentBlock: 56376258,
      // TESOURO uses a Redstone feed; add its event tracker separately.
      excludedPools: ['0x347e2c9230eab93c71fbae5d5cd134e61f181578'],
    },
    [Network.BASE]: {
      factory: '0x86ba17ebf8819f7fd32cf1a43abcaae541a5bebf',
      deploymentBlock: 32424817,
      excludedPools: ['0x4c69bff4b9a4451704b13c97fc5e9cd7cbe29f5f'],
    },
  },
};
