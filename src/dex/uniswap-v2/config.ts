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
  DefiSwap: {
    [Network.MAINNET]: {
      subgraphURL: 'G7W3G1JGcFbWseucNkHHvQorxyjQLEQt7vt9yPN97hri',
      factoryAddress: '0x9DEB29c9a4c7A88a3C0257393b7f3335338D9A9D',
      initCode:
        '0x69d637e77615df9f235f642acebbdad8963ef35c5523142078c9b8f9d0ceba7e',
      feeCode: 30,
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
  QuickSwap: {
    [Network.POLYGON]: {
      subgraphURL: 'FUWdkXWpi8JyhAnhKL5pZcVshpxuaUQG8JHMDqNCxjPd',
      factoryAddress: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
      initCode:
        '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      feeCode: 30,
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
  WaultFinance: {
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
  Alien: {
    [Network.BASE]: {
      factoryAddress: '0x3e84d913803b02a4a7f027165e8ca42c14c0fde7',
      subgraphURL: '6bg5PGSbcbiXVj6iTNNYz7CaJE8zdVZhZNNCYu8oYmPc',
      initCode: '0x', // deprecated
      poolGasCost: 90 * 1000,
      feeCode: 16,
    },
  },
};
