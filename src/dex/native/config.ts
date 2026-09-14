import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const NativeConfig: DexConfigMap<DexParams> = {
  Native: {
    [Network.MAINNET]: {
      routerAddress: '0x4777A6B3A9A889ABfd4C7666Bdd2a7AB633293be',
      chainName: 'ethereum',
    },
    [Network.BSC]: {
      routerAddress: '0x1fDED89D98CBeADd96a109D28689c2638025dad3',
      chainName: 'bsc',
    },
    [Network.ARBITRUM]: {
      routerAddress: '0x0183D055c77310aF03dCB397eFAA7E9cfB6dB59b',
      chainName: 'arbitrum',
    },
    [Network.BASE]: {
      routerAddress: '0x9706D3fff42571305Fc201F996ADC0e768d72911',
      chainName: 'base',
    },
  },
};
