import { AllVaultConfigs } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

export const CapConfig: DexConfigMap<AllVaultConfigs> = {
  Cap: {
    [Network.MAINNET]: {
      '0xcccc62962d17b8914c62d74ffb843d73b2a3cccc': {
        name: 'cUSD',
        priceOracle: '0xcD7f45566bc0E7303fB92A93969BB4D3f6e662bb',
        vault: {
          address: '0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC',
          decimals: 18,
        },
        assets: {
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: 6,
          },
        },
      },
    },
  },
};
