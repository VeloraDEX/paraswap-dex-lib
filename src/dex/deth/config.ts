import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export type DexParams = {
  deltaAdapter: string;
  wrappedToken: string;
};

export const dETHConfig: DexConfigMap<DexParams> = {
  dETH: {
    [Network.MAINNET]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
    [Network.ARBITRUM]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
    [Network.OPTIMISM]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
    [Network.BASE]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
    [Network.UNICHAIN]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
  },
  dBNB: {
    [Network.BSC]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
  },
  dPOL: {
    [Network.POLYGON]: {
      deltaAdapter: '0x0000000000bbf5c5fd284e657f01bd000933c96d',
      wrappedToken: '0x0a0d53b6684c7b32b4cbef5fe8483bfcc8406742',
    },
  },
};
