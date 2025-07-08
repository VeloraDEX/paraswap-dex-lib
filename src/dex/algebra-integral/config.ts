import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const AlgebraIntegralConfig: DexConfigMap<DexParams> = {
  QuickSwapV4: {
    [Network.POLYGON]: {
      factory: '0x96117a894c2c99aafeeacb972c3310e6ac83e810',
      subgraphURL: 'B8VaWM5T8miDW4TKdGRAkZXvLekpptQykxNV8vVP8fhg',
      quoter: '0xae65e71bcd7c84c8bc53532f6f784ed15a68f8b7',
      router: '0xee2a7a531bcf524392dc3db67bb400bae3833991',
      uniswapMulticall: '0x536310b521120dd3c195e78e5c26d61b938a4594',
      chunksCount: 10,
    },
    [Network.BASE]: {
      factory: '0xC5396866754799B9720125B104AE01d935Ab9C7b',
      subgraphURL: 'U65NKb6BsDPGqugPAda58ebMLa1RqeMFT76fndB77oe',
      quoter: '0xA8a1dA1279ea63535c7B3BE8D20241483BC61009',
      router: '0xe6c9bb24ddB4aE5c6632dbE0DE14e3E474c6Cb04',
      uniswapMulticall: '0xD55AbC52a0d9901AD07FEbe2903d05601E2a34dD',
      chunksCount: 10,
    },
  },
};
