import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const DEX_KEY = 'EkuboV3';

// TODO
export const EKUBO_CONFIG: DexConfigMap<DexParams> = {
  [DEX_KEY]: {
    [Network.MAINNET]: {
      subgraphId: '',
      core: '',
      oracle: '',
      twamm: '',
      mevCapture: '',
      quoteDataFetcher: '',
      twammDataFetcher: '',
      router: '',
    },
  },
};
