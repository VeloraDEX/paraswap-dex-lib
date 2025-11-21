import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const NativeConfig: DexConfigMap<DexParams> = {
  Native: {
    [Network.MAINNET]: {
      routerAddress: '0x8a2ddc0461Fcf96F81a05529Bed540d4f1eb2a00',
      chainName: 'ethereum',
    },
    [Network.BSC]: {
      routerAddress: '0xF064b069Ed18Eb5c61159247C55C5af79B28a968',
      chainName: 'bsc',
    },
    [Network.ARBITRUM]: {
      routerAddress: '0x0FC85a171bD0b53BF0bBace74F04B66170Ae3eAb',
      chainName: 'arbitrum',
    },
    [Network.BASE]: {
      routerAddress: '0xaEC634d949df14Be76dC317504C7b9a6a8A5f576',
      chainName: 'base',
    },
  },
};
