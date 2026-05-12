import { Network } from '../../constants';
import { Address } from '../../types';

export const MetricConfig: Record<number, { routerAddress: Address }> = {
  [Network.MAINNET]: {
    routerAddress: '0xcb41c10c6414acbea022c7662df4005dd8fbef91',
  },
  [Network.BASE]: {
    routerAddress: '0xa6a16c00b7e9dbe1d54aced7d6fe264fc4732eaf',
  },
  [Network.BSC]: {
    routerAddress: '0xa9a63266bb70eb3419c34c245f4318983f325bbd',
  },
  [Network.ARBITRUM]: {
    routerAddress: '0x82a562fd9f02d4346b95d3a2a501411979c8f920',
  },
  [Network.POLYGON]: {
    routerAddress: '0x976c26402e1ec10454c5fe6d2c9857dd57ae78f3',
  },
};

export const PRICE_LIMIT_ZERO_FOR_ONE = '1';
export const PRICE_LIMIT_ONE_FOR_ZERO = (2n ** 128n - 1n).toString();
