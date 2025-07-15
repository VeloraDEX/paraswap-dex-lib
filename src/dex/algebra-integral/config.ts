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
  },
};
