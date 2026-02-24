import { ERC4626Params } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ERC4626Config: DexConfigMap<ERC4626Params> = {
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
  fUSDT0: {
    [Network.PLASMA]: {
      vault: '0x1DD4b13fcAE900C60a350589BE8052959D2Ed27B', // fUSDT0
      asset: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USDT0
      decimals: 6,
    },
  },
  eUSDT0: {
    [Network.PLASMA]: {
      vault: '0x8Aec278c2fD4cc07B10A8865AEd33775f93EACe6', // eUSDT0
      asset: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USDT0
      decimals: 6,
    },
  },
  waPlaUSDT0: {
    [Network.PLASMA]: {
      vault: '0xE0126F0c4451B2B917064A93040fd4770D6774b5', // waPlaUSDT0
      asset: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USDT0
      decimals: 6,
    },
  },
  wOETH: {
    [Network.MAINNET]: {
      vault: '0xdcee70654261af21c44c093c300ed3bb97b78192', // wOETH
      asset: '0x856c4efb76c1d1ae02e20ceb03a2a6a08b0b8dc3', // OETH
    },
  },
  wOUSD: {
    [Network.MAINNET]: {
      vault: '0xd2af830e8cbdfed6cc11bab697bb25496ed6fa62', // wOUSD
      asset: '0x2a8e1e676ec238d8a992307b495b45b3feaa5e86', // OUSD
    },
  },
  wOS: {
    [Network.SONIC]: {
      vault: '0x9f0df7799f6fdad409300080cff680f5a23df4b1', // wOS
      asset: '0xb1e25689d55734fd3fffc939c4c3eb52dff8a794', // OS
    },
  },
  wsuperOETHb: {
    [Network.BASE]: {
      vault: '0x7fcd174e80f264448ebee8c88a7c4476aaf58ea6', // wsuperOETHb
      asset: '0xdbfefd2e8460a6ee4955a68582f85708baea60a3', // superOETHb
    },
  },
};
