import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const UsdcTransmuterConfig: DexConfigMap<DexParams> = {
  UsdcTransmuter: {
    [Network.GNOSIS]: {
      usdcTransmuterAddress: '0x0392a2f5ac47388945d8c84212469f545fae52b2',
      usdcToken: {
        address: '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83',
        decimals: 6,
      },
      usdceToken: {
        address: '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0',
        decimals: 6,
      },
    },
  },
};
