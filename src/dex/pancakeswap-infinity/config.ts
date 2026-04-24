import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import { DexParams } from './types';

export const PancakeSwapInfinityConfig: DexConfigMap<DexParams> = {
  PancakeSwapInfinity: {
    [Network.BSC]: {
      clPoolManager: '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b',
      router: '0xd9c500dff816a1da21a48a732d3498bf09dc9aeb',
      subgraphURL: '8jFYxwKP8tNGSDisucpHRK1ojUchZd7ELd8zh2ugHGDN',
    },
  },
};
