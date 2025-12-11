import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import { DexParams, SubgraphPool } from './types';
import { ArenaHook } from './hooks/arena/arena-hook';

export const UniswapV4Config: DexConfigMap<DexParams> = {
  UniswapV4: {
    [Network.MAINNET]: {
      poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
      subgraphURL: 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G',
      quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
      router: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      stateView: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227',
      stateMulticall: '0xDCf1849caCdfF839f93682262a04915f83a9dB0e',
    },
    [Network.BASE]: {
      poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
      // subgraphURL: '7SP2t3PQd7LX19riCfwX5znhFdULjwRofQZtRZMJ8iW8',
      subgraphURL: 'HNCFA9TyBqpo5qpe6QreQABAA1kV8g46mhkCcicu6v2R',
      quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
      router: '0x6ff5693b99212da76ad316178a184ab56d299b43',
      stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
      skipPoolsWithUnconventionalFees: true,
      stateMulticall: '0x223c5fc295557f634979827728558424cf879d44',
    },
    [Network.OPTIMISM]: {
      poolManager: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
      subgraphURL: '6RBtsmGUYfeLeZsYyxyKSUiaA6WpuC69shMEQ1Cfuj9u',
      quoter: '0x1f3131a13296fb91c90870043742c3cdbff1a8d7',
      router: '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
      stateView: '0xc18a3169788f4f75a170290584eca6395c75ecdb',
      stateMulticall: '0x4377Ead7BFC000711821934B72597bd700DD6E71',
    },
    [Network.ARBITRUM]: {
      poolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
      subgraphURL: 'G5TsTKNi8yhPSV7kycaE23oWbqv9zzNqR49FoEQjzq1r',
      quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
      router: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
      stateView: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990',
      stateMulticall: '0x482cA248d91E08668efF568Ebb9805694D4DC396',
    },
    [Network.POLYGON]: {
      poolManager: '0x67366782805870060151383f4bbff9dab53e5cd6',
      subgraphURL: 'CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND',
      quoter: '0xb3d5c3dfc3a7aebff71895a7191796bffc2c81b9',
      router: '0x1095692a6237d83c6a72f3f5efedb9a670c49223',
      stateView: '0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a',
      stateMulticall: '0xA97349A3e17463EA840867937605Bb1D80cd2EE3',
    },
    [Network.AVALANCHE]: {
      poolManager: '0x06380c0e0912312b5150364b9dc4542ba0dbbc85',
      subgraphURL: '49JxRo9FGxWpSf5Y5GKQPj5NUpX2HhpoZHpGzNEWQZjq',
      quoter: '0xbe40675bb704506a3c2ccfb762dcfd1e979845c2',
      router: '0x94b75331ae8d42c1b61065089b7d48fe14aa73b7',
      stateView: '0xc3c9e198c735a4b97e3e683f391ccbdd60b69286',
      stateMulticall: '0xf03feb5d6b26a68a773f1a77d7880fc5bdcc0581',
      supportedHooks: [ArenaHook],
    },
    [Network.BSC]: {
      poolManager: '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df',
      subgraphURL: '2qQpC8inZPZL4tYfRQPFGZhsE8mYzE67n5z3Yf5uuKMu',
      quoter: '0x9f75dd27d6664c475b90e105573e550ff69437b0',
      router: '0x1906c1d672b88cd1b9ac7593301ca990f94eae07',
      stateView: '0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4',
      stateMulticall: '0x3f5ef7d58ed47135d9911600c1dc1d0f8601b039',
    },
    [Network.UNICHAIN]: {
      poolManager: '0x1f98400000000000000000000000000000000004',
      subgraphURL: 'Bd8UnJU8jCRJKVjcW16GHM3FNdfwTojmWb3QwSAmv8Uc',
      quoter: '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
      router: '0xef740bf23acae26f6492b10de645d6b98dc8eaf3',
      stateView: '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2',
      stateMulticall: '0xf03fEb5d6B26a68a773f1a77d7880fc5BDcc0581',
    },
  },
};

export const UniswapV4PoolsList: Record<number, SubgraphPool[]> = {
  [Network.BASE]: [
    {
      fee: '7',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0xf13203ddbf2c9816a79b656a1a952521702715d92fea465b84ae2ed6e94a7f22',
      tickSpacing: '1',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // symbol: 'USDT',
      },
    },
    {
      fee: '500',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a',
      tickSpacing: '10',
      token0: {
        address: '0x0000000000000000000000000000000000000000', // symbol: 'ETH',
      },
      token1: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
    },
    {
      fee: '20',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0xd3020570106c58635ff7f549659c4c310409c9a5d698cb826842bc8a39e3ce81',
      tickSpacing: '1',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // symbol: 'USDT',
      },
    },
    {
      fee: '500',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x12d76c5c8ec8edffd3c143995b0aa43fe44a6d71eb9113796272909e54b8e078',
      tickSpacing: '10',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', // symbol: 'cbBTC',
      },
    },
    {
      fee: '5',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x7681c00520c26da8d8970c21a65461c726f274068eb08743debc1178e697044e',
      tickSpacing: '1',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // symbol: 'USDT',
      },
    },
    {
      fee: '3000',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x179492f1f9c7b2e2518a01eda215baab8adf0b02dd3a90fe68059c0cac5686f5',
      tickSpacing: '60',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', // symbol: 'cbBTC',
      },
    },
    {
      fee: '100',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0xcdcbb476543e5c703f7562009cb4e2a6c543dc09fe740abf8be0c01c31c82884',
      tickSpacing: '1',
      token0: {
        address: '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee', // symbol: 'GHO',
      },
      token1: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
    },
    {
      fee: '11',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x90305e6043c0879a665262237e4643df9b48c1ba51aec5abe82c5d98f0da54bd',
      tickSpacing: '1',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // symbol: 'USDT',
      },
    },
    {
      fee: '90',
      hooks: '0x4440854b2d02c57a0dc5c58b7a884562d875c0c4',
      id: '0xaf15cd1f9c3874bbcfddfc2b544544612c9de8c8bae28ba21c129c6b286c1e19',
      tickSpacing: '2',
      token0: {
        address: '0x0000000000000000000000000000000000000000', // symbol: 'ETH',
      },
      token1: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
    },
    {
      fee: '6',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0xfba2c4592d32a4e2e6393b8898f9110b4e272983f4bd416b38f81672a17fe3dc',
      tickSpacing: '1',
      token0: {
        address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
      },
      token1: {
        address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // symbol: 'USDT',
      },
    },
    // {
    //   fee: '8388608',
    //   hooks: '0xdd5eeaff7bd481ad55db083062b13a3cdf0a68cc',
    //   id: '0xd6ba4bdd2ebdde6b9beab0085f42f08bf69a80e515e399cf93716505c738169b',
    //   tickSpacing: '200',
    //   token0: {
    //     address: '0x4200000000000000000000000000000000000006', // symbol: 'WETH',
    //   },
    //   token1: {
    //     address: '0x4a0aaf171446dda0ed95295c46820e2015a28b07', // symbol: 'QE',
    //   },
    // },
    // {
    //   fee: '3000',
    //   hooks: '0x0000000000000000000000000000000000000000',
    //   id: '0xe070797535b13431808f8fc81fdbe7b41362960ed0b55bc2b6117c49c51b7eb9',
    //   tickSpacing: '60',
    //   token0: {
    //     address: '0x0000000000000000000000000000000000000000', // symbol: 'ETH',
    //   },
    //   token1: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    // },
    // {
    //   fee: '10000',
    //   hooks: '0x0000000000000000000000000000000000000000',
    //   id: '0x438c7f6a3b32fdcf043ad3285dbc128486df894a1f3d448b1da38b2f2a1a43cb',
    //   tickSpacing: '200',
    //   token0: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    //   token1: {
    //     address: '0xc0634090f2fe6c6d75e61be2b949464abb498973', // symbol: 'KTA',
    //   },
    // },
    // {
    //   fee: '8388608',
    //   hooks: '0x34a45c6b61876d739400bd71228cbcbd4f53e8cc',
    //   id: '0x9cda3a1ca4814877cfc50f17cb3f428dd553a53bdb5836c6f181ff24574e4320',
    //   tickSpacing: '200',
    //   token0: {
    //     address: '0x4200000000000000000000000000000000000006', // symbol: 'WETH',
    //   },
    //   token1: {
    //     address: '0x5eeb2662615782b58251b6f0c3e107571ae1ab07', // symbol: 'RETAKE',
    //   },
    // },
    // {
    //   fee: '30000',
    //   hooks: '0x9ea932730a7787000042e34390b8e435dd839040',
    //   id: '0xbfadeecc6ae215a0ff707ac2dcb01055c89a8ff003046e883bc5e554ee7465fd',
    //   tickSpacing: '200',
    //   token0: {
    //     address: '0x4200000000000000000000000000000000000006', // symbol: 'WETH',
    //   },
    //   token1: {
    //     address: '0x885a590198e5f0947f4c92db815cf2a2147980b8', // symbol: 'BaseShake',
    //   },
    // },

    //

    // {
    //   fee: '500',
    //   hooks: '0x0000000000000000000000000000000000000000',
    //   id: '0xa18262d729e388b0a67aa65c0dd2a096482b3a27058be5547a3235d053dd90b4',
    //   tickSpacing: '10',
    //   token0: {
    //     address: '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee', // symbol: 'GHO',
    //   },
    //   token1: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    // },
    // {
    //   fee: '100',
    //   hooks: '0x0000000000000000000000000000000000000000',
    //   id: '0x322d9aef3cf895da9e35b95b6c6e8f3c5e2a90b6d447a8bbb1ff2616b608a4d0',
    //   tickSpacing: '1',
    //   token0: {
    //     address: '0x102d758f688a4c1c5a80b116bd945d4455460282', // symbol: 'USD₮0',
    //   },
    //   token1: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    // },
    // {
    //   fee: '8',
    //   hooks: '0x0000000000000000000000000000000000000000',
    //   id: '0xe1d05fe2b899df927bc67e5eedaccb95d06bf7c769ed68469bb773615f2401f8',
    //   tickSpacing: '1',
    //   token0: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    //   token1: {
    //     address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // symbol: 'USDT',
    //   },
    // },
    // {
    //   fee: '1500',
    //   hooks: '0x0000000000000000000000000000000000000000',
    //   id: '0x071526b476f0c45aaebdb6805b96405b8d29c1a47897ade98fbd410db0e3d4d8',
    //   tickSpacing: '30',
    //   token0: {
    //     address: '0x0000000000000000000000000000000000000000', // symbol: 'ETH',
    //   },
    //   token1: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    // },
    // {
    //   fee: '10',
    //   hooks: '0x4440854b2d02c57a0dc5c58b7a884562d875c0c4',
    //   id: '0xa0ab20a64f46b5676fe1542cb87b454e5104007689e0eef4212aa0cbe34933a1',
    //   tickSpacing: '1',
    //   token0: {
    //     address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // symbol: 'USDC',
    //   },
    //   token1: {
    //     address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // symbol: 'USDbC',
    //   },
    // },
  ],
};
