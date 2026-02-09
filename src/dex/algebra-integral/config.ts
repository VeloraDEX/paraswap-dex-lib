import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const AlgebraIntegralConfig: DexConfigMap<DexParams> = {
  QuickSwapV4: {
    [Network.BASE]: {
      factory: '0xC5396866754799B9720125B104AE01d935Ab9C7b',
      subgraphURL: 'U65NKb6BsDPGqugPAda58ebMLa1RqeMFT76fndB77oe',
      quoter: '0xA8a1dA1279ea63535c7B3BE8D20241483BC61009',
      router: '0xe6c9bb24ddB4aE5c6632dbE0DE14e3E474c6Cb04',
      chunksCount: 10,
    },
  },
  BlackholeCL: {
    [Network.AVALANCHE]: {
      factory: '0x512eb749541B7cf294be882D636218c84a5e9E5F',
      subgraphURL:
        'https://api.goldsky.com/api/public/project_cm8gyxv0x02qv01uphvy69ey6/subgraphs/poap-subgraph-core/mainnet-1.0.2/gn',
      quoter: '0x3e182bcf14Be6142b9217847ec1112e3c39Eb689',
      router: '0xaBfc48e8BED7b26762745f3139555F320119709d',
      chunksCount: 10,
    },
  },
  TrebleSwap: {
    [Network.BASE]: {
      factory: '0x6e606Cf94A4DDc01aEed2Fce16d1b4f5B33e0A31',
      subgraphURL: '3sThy2UsWd9X3D2M6MUQWzNUYrs8snMMhQKHSg9kUEAd',
      quoter: '0x4b25da09909A2CAF6ec8584B09BA0e24519A46fa',
      router: '0x309959994fc3fC6F789796923408f27748879b01',
      chunksCount: 10,
    },
  },
};
