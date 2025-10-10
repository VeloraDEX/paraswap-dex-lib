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
  sUSDe: {
    [Network.MAINNET]: {
      vault: '0x9d39a5de30e57443bff2a8307a4256c8797a3497', // sUSDe
      asset: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
      cooldownEnabled: true,
    },
  },
  yoETH: {
    [Network.BASE]: {
      vault: '0x3a43aec53490cb9fa922847385d82fe25d0e9de7', // yoETH
      asset: '0x4200000000000000000000000000000000000006', // WETH
      withdrawDisabled: true,
    },
  },
  yoUSD: {
    [Network.BASE]: {
      vault: '0x0000000f2eb9f69274678c76222b35eec7588a65', // yoUSD
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      decimals: 6,
      withdrawDisabled: true,
    },
  },
  stcUSD: {
    [Network.MAINNET]: {
      vault: '0x88887bE419578051FF9F4eb6C858A951921D8888', // stcUSD
      asset: '0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC', // cUSD
    },
  },
};
