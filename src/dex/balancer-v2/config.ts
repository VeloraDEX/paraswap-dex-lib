import { DexParams } from './types';
import { AdapterMappings, DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

export const BalancerConfig: DexConfigMap<DexParams> = {
  BalancerV2: {
    [Network.MAINNET]: {
      subgraphURL: 'C4ayEZP2yTXRAB8vSaTrgN4m9anTe9Mdm2ViyiAuV9TV',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'MAINNET',
    },
    [Network.POLYGON]: {
      subgraphURL: 'H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'POLYGON',
    },
    [Network.ARBITRUM]: {
      subgraphURL: '98cQDy6tufTJtshDCuhh9z2kWXsQWBHVh2bqnLHsGAeS',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'ARBITRUM',
    },
    [Network.AVALANCHE]: {
      subgraphURL: '7asfmtQA1KYu6CP7YVm5kv4bGxVyfAHEiptt2HMFgkHu',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'AVALANCHE',
    },
    [Network.BASE]: {
      subgraphURL: 'E7XyutxXVLrp8njmjF16Hh38PCJuHm12RRyMt5ma4ctX',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'BASE',
    },
    [Network.GNOSIS]: {
      subgraphURL: 'EJezH1Cp31QkKPaBDerhVPRWsKVZLrDfzjrLqpmv6cGg',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'GNOSIS',
    },
  },
  BeetsFi: {
    [Network.SONIC]: {
      subgraphURL: 'wwazpiPPt5oJMiTNnQ2VjVxKnKakGDuE2FfEZPD4TKj',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'SONIC',
    },
    [Network.OPTIMISM]: {
      subgraphURL: 'F5jeL2nMXZt5LU6kSway7Vi2PTUcqDbw1gMQEbrmiVdJ',
      vaultAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      apiNetworkName: 'OPTIMISM',
    },
  },
  // There is almost no liquidity: <12k$. Do not re-enable if protocol is not revived
  // Embr: {
  //  [Network.AVALANCHE]: {
  //    subgraphURL:
  //       'https://api.thegraph.com/subgraphs/name/embrfinance/embr-avalanche-v2',
  //    vaultAddress: '0xad68ea482860cd7077a5D0684313dD3a9BC70fbB',
  //  },
  // },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter02', index: 9 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 9 }],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter01', index: 9 }],
    [SwapSide.BUY]: [{ name: 'PolygonBuyAdapter', index: 6 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter01', index: 5 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter', index: 6 }],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter01', index: 4 }],
    [SwapSide.BUY]: [{ name: 'OptimismBuyAdapter', index: 5 }],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter01', index: 8 }],
    [SwapSide.BUY]: [{ name: 'AvalancheBuyAdapter', index: 7 }],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 4 }],
    [SwapSide.BUY]: [{ name: 'BaseBuyAdapter', index: 3 }],
  },
};
