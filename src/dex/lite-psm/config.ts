import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Warning: Addresses should be lowercased
export const LitePsmConfig: DexConfigMap<DexParams> = {
  LitePsm: {
    [Network.MAINNET]: {
      dai: {
        address: '0x6b175474e89094c44da98b954eedeac495271d0f',
        decimals: 18,
      },
      usds: {
        address: '0xdc035d45d973e3ec169d2276ddab16f1e407384f',
        decimals: 18,
      },
      usdsPsmAddress: '0xA188EEC8F81263234dA3622A406892F3D630f98c',
      vatAddress: '0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b',
      pools: [
        {
          gem: {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            decimals: 6,
          },
          pocketAddress: '0x37305b1cd40574e4c5ce33f8e8306be057fd7341',
          psmAddress: '0xf6e72db5454dd049d0788e411b06cfaf16853042',
          identifier:
            '0x4c4954452d50534d2d555344432d410000000000000000000000000000000000', // bytes32("LITE-PSM-USDC-A")
        },
      ],
    },
  },
};
