import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import { DexParams } from './types';

export const UniswapV4Config: DexConfigMap<DexParams> = {
  UniswapV4: {
    [Network.MAINNET]: {
      poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
      subgraphURL: 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G',
      quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
      router: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      stateView: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227',
      chunksCount: 10,
    },
    [Network.BASE]: {
      poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
      subgraphURL: 'HNCFA9TyBqpo5qpe6QreQABAA1kV8g46mhkCcicu6v2R',
      quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
      router: '0x6ff5693b99212da76ad316178a184ab56d299b43',
      stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
      chunksCount: 10,
      skipPoolsWithUnconventionalFees: true,
    },
    [Network.OPTIMISM]: {
      poolManager: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
      subgraphURL: '6RBtsmGUYfeLeZsYyxyKSUiaA6WpuC69shMEQ1Cfuj9u',
      quoter: '0x1f3131a13296fb91c90870043742c3cdbff1a8d7',
      router: '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
      stateView: '0xc18a3169788f4f75a170290584eca6395c75ecdb',
      chunksCount: 10,
    },
    [Network.ARBITRUM]: {
      poolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
      subgraphURL: 'G5TsTKNi8yhPSV7kycaE23oWbqv9zzNqR49FoEQjzq1r',
      quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
      router: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
      stateView: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990',
      chunksCount: 10,
    },
    [Network.POLYGON]: {
      poolManager: '0x67366782805870060151383f4bbff9dab53e5cd6',
      subgraphURL: 'CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND',
      quoter: '0xb3d5c3dfc3a7aebff71895a7191796bffc2c81b9',
      router: '0x1095692a6237d83c6a72f3f5efedb9a670c49223',
      stateView: '0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a',
      chunksCount: 10,
    },
    [Network.AVALANCHE]: {
      poolManager: '0x06380c0e0912312b5150364b9dc4542ba0dbbc85',
      subgraphURL: '49JxRo9FGxWpSf5Y5GKQPj5NUpX2HhpoZHpGzNEWQZjq',
      quoter: '0xbe40675bb704506a3c2ccfb762dcfd1e979845c2',
      router: '0x94b75331ae8d42c1b61065089b7d48fe14aa73b7',
      stateView: '0xc3c9e198c735a4b97e3e683f391ccbdd60b69286',
      chunksCount: 10,
    },
    [Network.BSC]: {
      poolManager: '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df',
      subgraphURL: '2qQpC8inZPZL4tYfRQPFGZhsE8mYzE67n5z3Yf5uuKMu',
      quoter: '0x9f75dd27d6664c475b90e105573e550ff69437b0',
      router: '0x1906c1d672b88cd1b9ac7593301ca990f94eae07',
      stateView: '0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4',
      chunksCount: 10,
    },
    [Network.UNICHAIN]: {
      poolManager: '0x1f98400000000000000000000000000000000004',
      subgraphURL: 'Bd8UnJU8jCRJKVjcW16GHM3FNdfwTojmWb3QwSAmv8Uc',
      quoter: '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
      router: '0xef740bf23acae26f6492b10de645d6b98dc8eaf3',
      stateView: '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2',
      chunksCount: 10,
    },
  },
};
