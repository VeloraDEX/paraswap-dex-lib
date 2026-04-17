import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import { RENEGADE_NAME } from './constants';

export const RenegadeConfig: DexConfigMap<DexParams> = {
  [RENEGADE_NAME]: {
    [Network.ARBITRUM]: {
      usdcAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    },
    [Network.BASE]: {
      usdcAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    },
  },
};
