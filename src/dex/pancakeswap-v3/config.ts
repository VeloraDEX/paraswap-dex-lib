import { DexParams } from '../uniswap-v3/types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

const PANCAKE_SUPPORTED_FEES = [10000n, 2500n, 500n, 100n];

// Pools that will be initialized on app startup
// They are added for testing
export const PancakeswapV3Config: DexConfigMap<DexParams> = {
  PancakeswapV3: {
    [Network.MAINNET]: {
      factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      deployer: '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9',
      quoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
      router: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      supportedFees: PANCAKE_SUPPORTED_FEES,
      stateMulticall: '0x80898f80cFA3Fa3AbF410d90e69aDc432AE5D4c2',
      uniswapMulticall: '0xac1cE734566f390A94b00eb9bf561c2625BF44ea',
      chunksCount: 10,
      initRetryFrequency: 10,
      initHash:
        '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2',
      subgraphURL: 'CJYGNhb7RvnhfBDjqpRnD3oxgyhibzc7fkAMa38YV3oS',
    },
    [Network.BSC]: {
      factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      deployer: '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9',
      quoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
      router: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      supportedFees: PANCAKE_SUPPORTED_FEES,
      stateMulticall: '0x9DAd2ED7ADc6eaacf81589Cd043579c9684E5C81',
      uniswapMulticall: '0xac1cE734566f390A94b00eb9bf561c2625BF44ea',
      chunksCount: 10,
      initRetryFrequency: 30,
      initHash:
        '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2',
      subgraphURL: 'Hv1GncLY5docZoGtXjo4kwbTvxm3MAhVZqBZE4sUT9eZ',
    },
    [Network.ARBITRUM]: {
      factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      deployer: '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9',
      quoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
      router: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      supportedFees: PANCAKE_SUPPORTED_FEES,
      stateMulticall: '0xF8498aCeD3aFa417653415B8e32BAE9d764FBFf5',
      uniswapMulticall: '0x1F98415757620B543A52E61c46B32eB19261F984',
      chunksCount: 10,
      initRetryFrequency: 30,
      initHash:
        '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2',
      subgraphURL: '251MHFNN1rwjErXD2efWMpNS73SANZN8Ua192zw6iXve',
    },
    [Network.BASE]: {
      factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      deployer: '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9',
      quoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
      router: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      supportedFees: PANCAKE_SUPPORTED_FEES,
      stateMulticall: '0xeBF40A40CA3D4310Bf53048F48e860656e1D7C81',
      uniswapMulticall: '0x091e99cb1C49331a94dD62755D168E941AbD0693',
      chunksCount: 10,
      initRetryFrequency: 30,
      initHash:
        '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2',
      subgraphURL: 'BHWNsedAHtmTCzXxCCDfhPmm6iN9rxUhoRHdHKyujic3',
    },
  },
  DackieSwapV3: {
    [Network.BASE]: {
      factory: '0x3D237AC6D2f425D2E890Cc99198818cc1FA48870',
      quoter: '0x4fDBD73aD4B1DDde594BF05497C15f76308eFfb9',
      deployer: '0x4f205D69834f9B101b9289F7AFFAc9B77B3fF9b7',
      router: '0x4030ebafeb76e5fc848891076dfe315993800ba5',
      supportedFees: [10000n, 2500n, 500n, 100n],
      stateMulticall: '0xeBF40A40CA3D4310Bf53048F48e860656e1D7C81',
      uniswapMulticall: '0x091e99cb1C49331a94dD62755D168E941AbD0693',
      chunksCount: 10,
      initRetryFrequency: 10,
      initHash: `0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2`,
      subgraphURL:
        'https://api.studio.thegraph.com/query/50473/v3-base/version/latest',
    },
  },
  SwapBasedV3: {
    [Network.BASE]: {
      factory: '0xb5620f90e803c7f957a9ef351b8db3c746021bea',
      quoter: '0x4fDBD73aD4B1DDde594BF05497C15f76308eFfb9',
      deployer: '0x905a650133147012390c42624eeba4d3313bec6c',
      router: '0x756c6bbdd915202adac7bebb1c6c89ac0886503f',
      supportedFees: [10000n, 2500n, 500n, 100n, 35n],
      stateMulticall: '0xeBF40A40CA3D4310Bf53048F48e860656e1D7C81',
      uniswapMulticall: '0x091e99cb1C49331a94dD62755D168E941AbD0693',
      chunksCount: 10,
      initRetryFrequency: 10,
      initHash: `0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2`,
      subgraphURL: 'Bj8g9Kso3a2fkhp8S3vBkHYq7FVPV1hVboThRtgdPwRF',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter01', index: 6 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 2 }],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter02', index: 4 }],
    [SwapSide.BUY]: [{ name: 'BscBuyAdapter', index: 5 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter01', index: 3 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter', index: 2 }],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 1 }],
    [SwapSide.BUY]: [{ name: 'BaseBuyAdapter', index: 1 }],
  },
};
