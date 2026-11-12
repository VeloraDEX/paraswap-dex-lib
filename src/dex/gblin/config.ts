import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const GblinConfig: DexConfigMap<DexParams> = {
  Gblin: {
    [Network.BASE]: {
      vault: '0xc2181d975c05c8c724b334bcED0764c0b86B1D53',
      lens: '0xfCFea8027019E8551A1f09AD91532471F5D26f61',
      weth: '0x4200000000000000000000000000000000000006',
      feedAggregators: [
        '0x05c84a58FE042275b37db038bAAcD15F410c7bB0', // ETH / USD
        '0x51cE3091Cf646587E02Cad83b580992f8723e718', // cbBTC / USD
        '0x68bE4C50235205Ede361ac8244B1ee221CDDA5E2', // USDC / USD
      ],
    },
  },
};
