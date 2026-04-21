import { Network } from '../../constants';
import { Address } from '../../types';

export const MetricConfig: Record<number, { routerAddress: Address }> = {
  [Network.MAINNET]: {
    routerAddress: '0xcB41C10c6414aCbea022c7662df4005dd8FBEF91',
  },
  [Network.BASE]: {
    routerAddress: '0xA6A16C00B7E9DBE1D54acEd7d6FE264fc4732eaF',
  },
  [Network.BSC]: {
    routerAddress: '0xa9a63266bB70eb3419C34C245F4318983f325Bbd',
  },
  [Network.ARBITRUM]: {
    routerAddress: '0x82A562fD9F02d4346B95D3a2a501411979C8F920',
  },
  [Network.POLYGON]: {
    routerAddress: '0x976c26402E1EC10454c5Fe6D2C9857DD57aE78f3',
  },
};

export const PRICE_LIMIT_ZERO_FOR_ONE = '1';
export const PRICE_LIMIT_ONE_FOR_ZERO = (2n ** 128n - 1n).toString();
