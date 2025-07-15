import { ERC4626Params } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ERC4626Config: DexConfigMap<ERC4626Params> = {
  wUSDM: {
    [Network.MAINNET]: {
      vault: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
      asset: '0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C',
    },
    [Network.OPTIMISM]: {
      vault: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
      asset: '0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C',
    },
    [Network.ARBITRUM]: {
      vault: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
      asset: '0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C',
    },
    [Network.BASE]: {
      vault: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
      asset: '0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C',
    },
    [Network.POLYGON]: {
      vault: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
      asset: '0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C',
    },
  },
  // might give 1wei difference on BUY
  sDAI: {
    [Network.GNOSIS]: {
      vault: '0xaf204776c7245bF4147c2612BF6e5972Ee483701', // sDAI
      asset: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', // WXDAI
    },
  },
  wUSDL: {
    [Network.MAINNET]: {
      vault: '0x7751E2F4b8ae93EF6B79d86419d42FE3295A4559', // wUSDL
      asset: '0xbdC7c08592Ee4aa51D06C27Ee23D5087D65aDbcD', // USDL
    },
  },
};
