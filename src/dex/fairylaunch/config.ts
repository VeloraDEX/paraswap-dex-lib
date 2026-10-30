import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const FairylaunchConfig: DexConfigMap<DexParams> = {
  Fairylaunch: {
    [Network.BSC]: {
      launchFactoryAddress: '0x28163d7943AA6715a9559D468B29c0343412E236',
    },
  },
};

export const Adapters: Record<number, string> = {
  [Network.BSC]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176fee57',
};