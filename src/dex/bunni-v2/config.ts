import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const BunniV2Config: DexConfigMap<DexParams> = {
  BunniV2: {
    [Network.MAINNET]: {
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
      quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
      router: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      bunniHubs: [
        '0x000000DCeb71f3107909b1b748424349bfde5493', // v1.0
        '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      ],
      bunniHooks: [
        '0x0010d0D5dB05933Fa0D9F7038D365E1541a41888', // v1.0
        '0x0000fE59823933AC763611a69c88F91d45F81888', // v1.1.1
        '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
      ],
      subgraphURL: '5NFnHtgpdzB3JhVyiKQgnV9dZsewqJtX5HZfAT9Kg66r',
    },
    [Network.ARBITRUM]: {
      WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32',
      quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
      router: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
      bunniHubs: [
        '0x000000DCeb71f3107909b1b748424349bfde5493', // v1.0
        '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      ],
      bunniHooks: [
        '0x0010d0D5dB05933Fa0D9F7038D365E1541a41888', // v1.0
        '0x0000fE59823933AC763611a69c88F91d45F81888', // v1.1.1
        '0x0000EB22c45bDB564F985acE0B4d05a64fa71888', // v1.2.1
      ],
      subgraphURL: '96tZMr51QupqWYamom12Yki5AqCJEiHWbVUpzUpvu9oB',
    },
    [Network.BASE]: {
      WETH: '0x4200000000000000000000000000000000000006',
      poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
      quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
      router: '0x6ff5693b99212da76ad316178a184ab56d299b43',
      bunniHubs: [
        '0x000000DCeb71f3107909b1b748424349bfde5493', // v1.0
        '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      ],
      bunniHooks: [
        '0x0010d0D5dB05933Fa0D9F7038D365E1541a41888', // v1.0
        '0x0000fE59823933AC763611a69c88F91d45F81888', // v1.1.1
        '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
      ],
      subgraphURL: '3oawHiCt7L9wJTEY9DynwAEmoThy8bvRhuMZdaaAooqW',
    },
    [Network.BSC]: {
      WETH: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      poolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
      quoter: '0x9F75dD27D6664c475B90e105573E550ff69437B0',
      router: '0x1906c1d672b88cD1B9aC7593301cA990F94Eae07',
      bunniHubs: [
        '0x000000DCeb71f3107909b1b748424349bfde5493', // v1.0
        '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      ],
      bunniHooks: [
        '0x0000fE59823933AC763611a69c88F91d45F81888', // v1.1.1
        '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
      ],
      subgraphURL: 'FfnRstqDWGGevsbf9rRg1vNctrb38Hd791zzaaKc7AGz',
    },
    [Network.UNICHAIN]: {
      WETH: '0x4200000000000000000000000000000000000006',
      poolManager: '0x1F98400000000000000000000000000000000004',
      quoter: '0x333E3C607B141b18fF6de9f258db6e77fE7491E0',
      router: '0xEf740bf23aCaE26f6492B10de645D6B98dC8Eaf3',
      bunniHubs: [
        '0x000000DCeb71f3107909b1b748424349bfde5493', // v1.0
        '0x00000091Cb2d7914C9cd196161Da0943aB7b92E1', // v1.2.0
        '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      ],
      bunniHooks: [
        '0x0000fE59823933AC763611a69c88F91d45F81888', // v1.1.1
        '0x005aF73a245d8171A0550ffAe2631f12cc211888', // v1.2.0
        '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
      ],
      subgraphURL: 'J22JEPtqL847G44v7E5gTsxmNosoLtKQUDAvnhRhzj25',
    },
  },
};
