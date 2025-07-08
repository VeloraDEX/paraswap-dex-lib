import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const EkuboConfig: DexConfigMap<DexParams> = {
  Ekubo: {
    [Network.MAINNET]: {
      apiUrl: 'https://eth-mainnet-api.ekubo.org',
      core: '0xe0e0e08A6A4b9Dc7bD67BCB7aadE5cF48157d444',
      oracle: '0x51d02a5948496a67827242eabc5725531342527c',
      twamm: '0xd4279c050da1f5c5b2830558c7a08e57e12b54ec',
      dataFetcher: '0x91cB8a896cAF5e60b1F7C4818730543f849B408c',
      twammDataFetcher: '0x8C4C1F26A9F26372b88f418A939044773eE5dC01',
      router: '0x9995855C00494d039aB6792f18e368e530DFf931',
    },
  },
};
