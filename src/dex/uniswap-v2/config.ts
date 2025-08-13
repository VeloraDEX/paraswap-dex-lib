import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

export const Adapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [
      {
        name: 'Adapter01',
        index: 4,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'BuyAdapter',
        index: 1,
      },
    ],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [
      {
        name: 'PolygonAdapter01',
        index: 4,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'PolygonBuyAdapter',
        index: 1,
      },
    ],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [
      {
        name: 'BscAdapter01',
        index: 3,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'BscBuyAdapter',
        index: 1,
      },
    ],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [
      {
        name: 'AvalancheAdapter01',
        index: 2,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'AvalancheBuyAdapter',
        index: 1,
      },
    ],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [
      {
        name: 'ArbitrumAdapter01',
        index: 2,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'ArbitrumBuyAdapter',
        index: 1,
      },
    ],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [
      {
        name: 'OptimismAdapter01',
        index: 2,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'OptimismBuyAdapter',
        index: 1,
      },
    ],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [
      {
        name: 'BaseAdapter01',
        index: 6,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'BaseBuyAdapter',
        index: 4,
      },
    ],
  },
};

export const UniswapV2Config: DexConfigMap<DexParams> = {
  UniswapV2: {
    [Network.MAINNET]: {
      subgraphURL: 'EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu',
      factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
    [Network.ARBITRUM]: {
      factoryAddress: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
    [Network.AVALANCHE]: {
      factoryAddress: '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
    [Network.BSC]: {
      factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
    [Network.BASE]: {
      factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
      subgraphURL: '4jGhpKjW4prWoyt5Bwk1ZHUwdEmNWveJcjEyjoTZWCY9',
    },
    [Network.OPTIMISM]: {
      factoryAddress: '0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
    [Network.POLYGON]: {
      factoryAddress: '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
    [Network.UNICHAIN]: {
      factoryAddress: '0x1f98400000000000000000000000000000000002',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  ApeSwap: {
    [Network.BSC]: {
      factoryAddress: '0x0841bd0b734e4f5853f0dd8d7ea041c241fb0da6',
      initCode:
        '0xf4ccce374816856d11f00e4069e7cada164065686fbef53c6167a63ec2fd8c5b',
      poolGasCost: 100 * 1000,
      feeCode: 20,
    },
    [Network.POLYGON]: {
      subgraphURL: '32BWziYZT6en9rVM9L3sDonnjHGtKvfsiJyMDv3T7Dx1',
      factoryAddress: '0xcf083be4164828f00cae704ec15a36d711491284',
      initCode:
        '0x511f0f358fe530cda0859ec20becf391718fdf5a329be02f4c95361f3d6a42d8',
      poolGasCost: 100 * 1000,
      feeCode: 20,
    },
  },
  Baguette: {
    [Network.AVALANCHE]: {
      subgraphURL: '61Lx9dF7BeNUF12QE4egX5N8iN8M5PPsXVNmHeq6KBMi',
      factoryAddress: '0x3587b8c0136c2c3605a9e5b03ab54da3e4044b50',
      initCode:
        '0xf4ccce374816856d11f00e4069e7cada164065686fbef53c6167a63ec2fd8c5b',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  BakerySwap: {
    [Network.BSC]: {
      factoryAddress: '0x01bF7C66c6BD861915CdaaE475042d3c4BaE16A7',
      initCode:
        '0xe2e87433120e32c4738a7d8f3271f3d872cbe16241d67537139158d90bac61d3',
      feeCode: 30,
      router: '0x4B8107Bbdf7f7adF7B42a1C9cF14FAD8d32111C0',
      adapters: {
        [SwapSide.SELL]: [
          {
            name: 'BscAdapter01',
            index: 11,
          },
        ],
        [SwapSide.BUY]: null,
      },
    },
  },
  CanarySwap: {
    [Network.AVALANCHE]: {
      subgraphURL: 'An3x5Mz4YXEERomXYC4AhGgNhRthPFXNYDnrMCjrAJe',
      factoryAddress: '0xCFBA329d49C24b70F3a8b9CC0853493d4645436b',
      initCode:
        '0x60df5edf580dff3274fff5a3d83ad2b6ef6e296f71c3bc28c939e641888bd5b0',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  CheeseSwap: {
    [Network.BSC]: {
      factoryAddress: '0xdd538e4fd1b69b7863e1f741213276a6cf1efb3b',
      initCode:
        '0xf52c5189a89e7ca2ef4f19f2798e3900fba7a316de7cef6c5a9446621ba86286',
      poolGasCost: 100 * 1000,
      feeCode: 20,
    },
  },
  CoinSwap: {
    [Network.BSC]: {
      factoryAddress: '0xc2d8d27f3196d9989abf366230a47384010440c0',
      initCode:
        '0x2e3f108b8526ff1faa4d526bb84210fc5a2bfc5aad2f62207d7964554a5d029d',
      poolGasCost: 100 * 1000,
      feeCode: 20,
    },
  },
  ComethSwap: {
    [Network.POLYGON]: {
      factoryAddress: '0x800b052609c355ca8103e06f022aa30647ead60a',
      initCode:
        '0x499154cad90a3563f914a25c3710ed01b9a43b8471a35ba8a66a056f37638542',
      feeCode: 50,
    },
  },
  ComplusSwap: {
    [Network.AVALANCHE]: {
      subgraphURL: 'GKMU4BaEfJpjHkrhgLdoS8wyWircmytNXN9KH3SmpkCL',
      factoryAddress: '0x5C02e78A3969D0E64aa2CFA765ACc1d671914aC0',
      initCode:
        '0x0f75b63316180834cae9ff38fbeb719026e1435e60ddb4509bd435f148feac97',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  DefiSwap: {
    [Network.MAINNET]: {
      subgraphURL: 'G7W3G1JGcFbWseucNkHHvQorxyjQLEQt7vt9yPN97hri',
      factoryAddress: '0x9DEB29c9a4c7A88a3C0257393b7f3335338D9A9D',
      initCode:
        '0x69d637e77615df9f235f642acebbdad8963ef35c5523142078c9b8f9d0ceba7e',
      feeCode: 30,
    },
  },
  ElkFinance: {
    [Network.AVALANCHE]: {
      subgraphURL: '2dyce92CewvhV17C8BMFoMCgaXdPTtwBzaz8AReQR3YV',
      factoryAddress: '0x091d35d7F63487909C863001ddCA481c6De47091',
      initCode:
        '0x33c4831a098654d3d20a78641a198ee6ffc1ceed49f2196b75bb244891c260e3',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  JulSwap: {
    [Network.BSC]: {
      // subgraphURL:
      //   'https://subgraph.swapliquidity.org/subgraphs/name/swapliquidity/subgraph',
      factoryAddress: '0x553990f2cba90272390f62c5bdb1681ffc899675',
      initCode:
        '0xb1e98e21a5335633815a8cfb3b580071c2e4561c50afd57a8746def9ed890b18',
      feeCode: 30,
    },
  },
  LinkSwap: {
    [Network.MAINNET]: {
      subgraphURL: '3H25xhPJELikCCTfQD8r1gYn3sM7CUtau3nspbo496rR',
      factoryAddress: '0x696708Db871B77355d6C2bE7290B27CF0Bb9B24b',
      initCode:
        '0x50955d9250740335afc702786778ebeae56a5225e4e18b7cb046e61437cde6b3',
      feeCode: 30,
    },
  },
  LydiaFinance: {
    [Network.AVALANCHE]: {
      factoryAddress: '0xe0C1bb6DF4851feEEdc3E14Bd509FEAF428f7655',
      initCode:
        '0x47cc4f3a5e7a237c464e09c6758ac645084f198b8f64eedc923317ac4481a10c',
      poolGasCost: 80 * 1000,
      feeCode: 20,
    },
  },
  PantherSwap: {
    [Network.BSC]: {
      factoryAddress: '0x670f55c6284c629c23bae99f585e3f17e8b9fc31',
      initCode:
        '0x867d1354ae93986b4c49f35d8d7884f174264895ad8501d50d2cd365933d4aa5',
      feeCode: 20,
    },
  },
  PangolinSwap: {
    [Network.AVALANCHE]: {
      subgraphURL: '7PRKughAkeESafrGZ8A2x1YsbNMQnFbxQ1bpeNjktwZk',
      factoryAddress: '0xefa94DE7a4656D787667C749f7E1223D71E9FD88',
      initCode:
        '0x40231f6b438bce0797c9ada29b718a87ea0a5cea3fe9a771abdd76bd41a3e545',
      poolGasCost: 89 * 1000,
      feeCode: 30,
    },
  },
  ArenaDex: {
    [Network.AVALANCHE]: {
      factoryAddress: '0x231DF4D421f1F9e0AAe9bA3634a87EBC87A09c39',
      initCode:
        '0x5eae27f407e5d417db3b2c176a2221883934aa8eecf365f8795afb69ee0b23d1',
      poolGasCost: 120 * 1000,
      feeCode: 30,
    },
  },
  ArenaDexV2: {
    [Network.AVALANCHE]: {
      factoryAddress: '0xF16784dcAf838a3e16bEF7711a62D12413c39BD1',
      initCode:
        '0xe5982ea9aa099c260fbe1f626ddf304ecab74f9d85fb8c5277156486875ab7fe',
      poolGasCost: 120 * 1000,
      feeCode: 30,
    },
  },
  PancakeSwap: {
    [Network.BSC]: {
      factoryAddress: '0xBCfCcbde45cE874adCB698cC183deBcF17952812',
      initCode:
        '0xd0d4c4cd0848c93cb4fd1f498d7013ee6bfb25783ea21593d5834f5d250ece66',
      poolGasCost: 80 * 1000,
      feeCode: 20,
    },
  },
  // RPC Pool Tracker is used
  PancakeSwapV2: {
    [Network.BSC]: {
      // subgraphURL: 'AD7yfts4Uzeav8eXQ6yxZ64VXjzDrJ1b76Gvka2VSnhd',
      factoryAddress: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73',
      initCode:
        '0xa0e5696e64d8512d41c1887d32c208c1f427abd6a077148d760fc07ccbe12470',
      poolGasCost: 90 * 1000,
      feeCode: 25,
    },
    [Network.MAINNET]: {
      factoryAddress: '0x1097053Fd2ea711dad45caCcc45EfF7548fCB362',
      initCode:
        '0x57224589c67f3f30a6b0d7a1b54cf3153ab84563bc609ef41dfb34f8b2974d2d',
      poolGasCost: 90 * 1000,
      feeCode: 25,
    },
    [Network.ARBITRUM]: {
      subgraphURL:
        'https://api.studio.thegraph.com/query/45376/exchange-v2-arbitrum/version/latest',
      factoryAddress: '0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E',
      initCode:
        '0x57224589c67f3f30a6b0d7a1b54cf3153ab84563bc609ef41dfb34f8b2974d2d',
      poolGasCost: 90 * 1000,
      feeCode: 25,
    },
  },
  SushiSwap: {
    [Network.MAINNET]: {
      subgraphURL: 'A4JrrMwrEXsYNAiYw7rWwbHhQZdj6YZg1uVy5wa6g821',
      factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
      initCode:
        '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      feeCode: 30,
    },
    [Network.POLYGON]: {
      subgraphURL: '8NiXkxLRT3R22vpwLB4DXttpEf3X1LrKhe4T1tQ3jjbP',
      factoryAddress: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
      initCode:
        '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      feeCode: 30,
    },
    [Network.SONIC]: {
      subgraphURL: 'DiS2ZgxR2upUs1s21wviEaY7hwjRWyrphhoBgKNc1Boo',
      factoryAddress: '0xB45e53277a7e0F1D35f2a77160e91e25507f1763',
      initCode:
        '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      feeCode: 30,
    },
    [Network.AVALANCHE]: {
      subgraphURL: '6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT',
      factoryAddress: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
      initCode:
        '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      feeCode: 30,
    },
    [Network.ARBITRUM]: {
      subgraphURL: '8nFDCAhdnJQEhQF3ZRnfWkJ6FkRsfAiiVabVn4eGoAZH',
      factoryAddress: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
      initCode:
        '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      feeCode: 30,
    },
    [Network.GNOSIS]: {
      subgraphURL: '7czeiia7ZXvsW45szX2w8EK1ZNgZWZET83zYCwE6JT9x',
      factoryAddress: '0xc35dadb65012ec5796536bd9864ed8773abc74c4',
      initCode:
        '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      feeCode: 30,
    },
  },
  HoneySwap: {
    [Network.GNOSIS]: {
      subgraphURL: '7vjh6q6gj6M1bhRNgkKZmWqd5jot79kV84BiQtUDQSdV',
      factoryAddress: '0xa818b4f111ccac7aa31d0bcc0806d64f2e0737d7',
      initCode:
        '0xdbd265d4828759db2a0351a7b97180bcc41449a038bcd08a45afe937147f6267',
      feeCode: 30,
    },
  },
  Zyberswap: {
    [Network.ARBITRUM]: {
      subgraphURL: '3g83GYhbyHtjy581vpTmN1AP9cB9MjWMh5TiuNpvTU4R',
      factoryAddress: '0xaC2ee06A14c52570Ef3B9812Ed240BCe359772e7',
      initCode:
        '0xfa2ad44b9e39d38a7d396bb44a41ea957ac7b622c5c6afdc285728c300b3382a',
      feeCode: 25,
    },
  },
  QuickSwap: {
    [Network.POLYGON]: {
      subgraphURL: 'FUWdkXWpi8JyhAnhKL5pZcVshpxuaUQG8JHMDqNCxjPd',
      factoryAddress: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      feeCode: 30,
    },
    [Network.BASE]: {
      subgraphURL:
        'https://api.studio.thegraph.com/query/113693/quickswap-v-2-base/version/latest',
      factoryAddress: '0xEC6540261aaaE13F236A032d454dc9287E52e56A',
      initCode:
        '0xa18736c3ee97fe3c96c9428c0cc2a9116facec18e84f95f9da30543f8238a782',
      feeCode: 30,
    },
  },
  SoulSwap: {
    [Network.AVALANCHE]: {
      subgraphURL:
        'https://api.thegraph.com/subgraphs/name/soulswapfinance/avalanche-exchange',
      factoryAddress: '0x5BB2a9984de4a69c05c996F7EF09597Ac8c9D63a',
      initCode:
        '0xab9f67104ee4239d49c6b434dc5d6d76f43412862be0f00a0607199ad505abc6',
      feeCode: 30,
    },
    [Network.FANTOM]: {
      subgraphURL:
        'https://api.thegraph.com/subgraphs/name/soulswapfinance/fantom-exchange',
      factoryAddress: '0x1120e150dA9def6Fe930f4fEDeD18ef57c0CA7eF',
      initCode:
        '0xf3dcc3c6c6e34d3981dd429ac942301b9ebdd05de1be17f646b55476c44dc951',
      feeCode: 30,
    },
  },
  SpookySwap: {
    [Network.SONIC]: {
      subgraphURL: '', // deployed on 0xgraph
      factoryAddress: '0xEE4bC42157cf65291Ba2FE839AE127e3Cc76f741',
      initCode:
        '0xc0a4478c7d7a8e51439185380bd1914dea14c12086db861090a5dc8d11b4e95b',
      feeCode: 20,
    },
  },
  ShibaSwap: {
    [Network.MAINNET]: {
      // subgraphURL: 'FvP7tK71rX51wsb663j5GRx2YTtDRa1Adq8QSCi5akLS',
      factoryAddress: '0x115934131916C8b277DD010Ee02de363c09d037c',
      initCode:
        '0x65d1a3b1e46c6e4f1be1ad5f99ef14dc488ae0549dc97db9b30afe2241ce1c7a',
      poolGasCost: 100 * 1000,
      feeCode: 30,
    },
  },
  ZeroSwap: {
    [Network.AVALANCHE]: {
      subgraphURL: 'AqPMxtsH3QagNavTVHVXq5B7EMFjFykhwLT3rbBsTUoa',
      factoryAddress: '0x2Ef422F30cdb7c5F1f7267AB5CF567A88974b308',
      initCode:
        '0x4b5b254233f8aba1e01c0538653d54036e3c9f7873daf99623bb358f1cf33188',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  YetiSwap: {
    [Network.AVALANCHE]: {
      subgraphURL: '3eghyQrrkqHWVGhFdQhMV76yb7JUpmY7EENgKodSbH7x',
      factoryAddress: '0x58C8CD291Fa36130119E6dEb9E520fbb6AcA1c3a',
      initCode:
        '0xcc133f6dd9577d2022e9f47ec90dd24049584e73131095c170715fa7c950a64a',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  WaultFinance: {
    [Network.BSC]: {
      subgraphURL: 'tyASNhX4AQEcYUG1zgdUNWVYZkPSNiY4Lw4U3ZLNd7n',
      factoryAddress: '0xB42E3FE71b7E0673335b3331B3e1053BD9822570',
      initCode:
        '0x9599db1eaa37ab366bf260f51beefce9296eb6197de387c533d905e9b82debe9',
      poolGasCost: 100 * 1000,
      feeCode: 20,
    },
    [Network.POLYGON]: {
      subgraphURL: '5z81JRDL5gtgK884YNvA9y913mEavzBpL7Hn1m2kjLYu',
      factoryAddress: '0xa98ea6356A316b44Bf710D5f9b6b4eA0081409Ef',
      initCode:
        '0x1cdc2246d318ab84d8bc7ae2a3d81c235f3db4e113f4c6fdc1e2211a9291be47',
      poolGasCost: 100 * 1000,
      feeCode: 20,
    },
  },
  TraderJoe: {
    [Network.AVALANCHE]: {
      subgraphType: 'deployments',
      subgraphURL: 'QmWJU3wdTo34YphxMh4Nf7NBdVjmH82EC5Zj75L8yrXSHG',
      factoryAddress: '0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10',
      initCode:
        '0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91',
      poolGasCost: 120 * 1000,
      feeCode: 30,
    },
  },
  Verse: {
    [Network.MAINNET]: {
      factoryAddress: '0xee3E9E46E34a27dC755a63e2849C9913Ee1A06E2',
      initCode:
        '0x34768b85d02b77066b16acc7f0875ed59566bb3c32ba4fb0438750e872fddf9e',
      feeCode: 30,
    },
  },
  ZipSwap: {
    [Network.OPTIMISM]: {
      subgraphURL: '5tAUjmnM9iE4aADZwKhk3fobY8fMFbb1VMsrSKvo4kFr',
      factoryAddress: '0x8BCeDD62DD46F1A76F8A1633d4f5B76e0CDa521E',
      initCode:
        '0x1a76b7e7272f6187014e23f04d1b2e543eed2fd1f76481149008cc6eacb05c22',
      poolGasCost: 80 * 1000,
      feeCode: 30,
    },
  },
  BaseSwap: {
    [Network.BASE]: {
      factoryAddress: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB',
      initCode:
        '0xb618a2730fae167f5f8ac7bd659dd8436d571872655bcb6fd11f2158c8a64a3b',
      poolGasCost: 90 * 1000,
      feeCode: 25,
    },
  },
  Alien: {
    [Network.BASE]: {
      factoryAddress: '0x3e84d913803b02a4a7f027165e8ca42c14c0fde7',
      subgraphURL: '6bg5PGSbcbiXVj6iTNNYz7CaJE8zdVZhZNNCYu8oYmPc',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 16,
    },
  },
  RocketSwap: {
    [Network.BASE]: {
      factoryAddress: '0x1b8128c3a1b7d20053d10763ff02466ca7ff99fc',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 30,
    },
  },
  SoSwap: {
    [Network.BASE]: {
      factoryAddress: '0x539db2B4FE8016DB2594d7CfbeAb4d2B730b723E',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 30,
    },
  },
  SwapBased: {
    [Network.BASE]: {
      factoryAddress: '0x04C9f118d21e8B767D2e50C946f0cC9F6C367300',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 30,
    },
  },
  SharkSwap: {
    [Network.BASE]: {
      factoryAddress: '0x57592d44eb60011500961ef177bff8d8691d5a8b',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 30,
    },
  },
  DackieSwap: {
    [Network.BASE]: {
      factoryAddress: '0x591f122D1df761E616c13d265006fcbf4c6d6551',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 25,
    },
  },
};
