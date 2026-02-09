import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const DEX_KEY = 'Ekubo';

export const EKUBO_CONFIG: DexConfigMap<DexParams> = {
  [DEX_KEY]: {
    [Network.MAINNET]: {
      apiUrl: 'https://eth-mainnet-api.ekubo.org',
      core: '0xe0e0e08A6A4b9Dc7bD67BCB7aadE5cF48157d444',
      oracle: '0x51d02A5948496a67827242EaBc5725531342527C',
      twamm: '0xD4279c050DA1F5c5B2830558C7A08E57e12b54eC',
      mevResist: '0x553a2EFc570c9e104942cEC6aC1c18118e54C091',
      dataFetcher: '0x91cB8a896cAF5e60b1F7C4818730543f849B408c',
      twammDataFetcher: '0x8C4C1F26A9F26372b88f418A939044773eE5dC01',
      router: '0x0c95eA31e4501B3b879Cae2232087E478D44aEAB',
    },
  },
};
