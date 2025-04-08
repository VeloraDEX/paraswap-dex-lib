import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';
import { gnosisChainUsdcTransmuterAddress } from './constants';

export const UsdcTransmuterConfig: DexConfigMap<DexParams> = {
  UsdcTransmuter: {
    [Network.GNOSIS]: {
      address: gnosisChainUsdcTransmuterAddress,
    },
  },
};
