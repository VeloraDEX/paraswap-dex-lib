import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

import { GhoEthereum, AaveSafetyModule } from '@bgd-labs/aave-address-book';

export const StkGHOConfig: DexConfigMap<DexParams> = {
  StkGHO: {
    [Network.MAINNET]: {
      stkGHO: AaveSafetyModule.STK_GHO,
      GHO: GhoEthereum.GHO_TOKEN,
    },
  },
};
