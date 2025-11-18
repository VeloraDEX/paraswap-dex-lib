import { DexParams, ImplementationNames } from '../curve-v1-factory/types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';
import { configAddressesNormalizer } from '../curve-v1-factory/config';

// stable ng factories addresses are taken from https://github.com/curvefi/curve-api/blob/main/constants/configs/configs.js
const CurveV1StableNgConfig: DexConfigMap<DexParams> = {
  CurveV1StableNg: {
    [Network.MAINNET]: {
      factories: [
        {
          address: '0x6A8cbed756804B16E05E741eDaBd5cB544AE21bf',
          isStableNg: true,
        },
      ],
      router: '0x16C6521Dff6baB339122a0FE25a9116693265353', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 5 * 1000,
      disabledPools: new Set([
        '0x37636263da44423349788326b860311f5db0dd20', // USDC - USDT - SPANK
      ]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xdcc91f930b42619377c200ba05b7513f2958b202': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xdcc91f930b42619377c200ba05b7513f2958b202',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0x933f4769dcc27fc7345d9d5975ae48ec4d0f829c': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x933f4769dcc27fc7345d9d5975ae48ec4d0f829c',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xede71f77d7c900dca5892720e76316c6e575f0f7': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xede71f77d7c900dca5892720e76316c6e575f0f7',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xdd7ebb1c49780519dd9755b8b1a23a6f42ce099e': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xdd7ebb1c49780519dd9755b8b1a23a6f42ce099e',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0x3e3b5f27bbf5cc967e074b70e9f4046e31663181': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x3e3b5f27bbf5cc967e074b70e9f4046e31663181',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0x64afa95e0c3d8410240a4262df9fd82b12b64edd': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x64afa95e0c3d8410240a4262df9fd82b12b64edd',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0x1f7c86affe5bcf7a1d74a8c8e2ef9e03bf31c1bd': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x1f7c86affe5bcf7a1d74a8c8e2ef9e03bf31c1bd',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xc65cb3156225380beda366610bab18d5835a1647': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xc65cb3156225380beda366610bab18d5835a1647',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xa0ec67a3c483674f77915893346a8ca3abe2b785': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xa0ec67a3c483674f77915893346a8ca3abe2b785',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.POLYGON]: {
      factories: [
        {
          address: '0x1764ee18e8B3ccA4787249Ceb249356192594585',
          isStableNg: true,
        },
      ],
      router: '0x0DCDED3545D565bA3B19E683431381007245d983', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xe265fc390e9129b7e337da23cd42e00c34da2ce3': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xe265fc390e9129b7e337da23cd42e00c34da2ce3',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xa7ba18eefcd9513230987ec2fab6711af5abd9c2': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xa7ba18eefcd9513230987ec2fab6711af5abd9c2',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.SONIC]: {
      factories: [
        {
          address: '0x7c2085419be6a04f4ad88ea91bc9f5c6e6c463d8',
          isStableNg: true,
        },
      ],
      router: '0x5eeE3091f747E60a045a2E715a4c71e600e31F6E',
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xe61Fb97Ef6eBFBa12B36Ffd7be785c1F5A2DE66b': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xe61Fb97Ef6eBFBa12B36Ffd7be785c1F5A2DE66b',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0x8663426e8713922d81e44d73295759e74afc230f': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x8663426e8713922d81e44d73295759e74afc230f',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.ARBITRUM]: {
      factories: [
        {
          address: '0x9AF14D26075f142eb3F292D5065EB3faa646167b',
          isStableNg: true,
        },
      ],
      router: '0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xf6841c27fe35ed7069189afd5b81513578afd7ff': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xf6841c27fe35ed7069189afd5b81513578afd7ff',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xff02cbd91f57a778bab7218da562594a680b8b61': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xff02cbd91f57a778bab7218da562594a680b8b61',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.OPTIMISM]: {
      factories: [
        {
          address: '0x5eeE3091f747E60a045a2E715a4c71e600e31F6E',
          isStableNg: true,
        },
      ],
      router: '0x0DCDED3545D565bA3B19E683431381007245d983', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0x635742dcc8313dcf8c904206037d962c042eafbd': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x635742dcc8313dcf8c904206037d962c042eafbd',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.BASE]: {
      factories: [
        {
          address: '0xd2002373543Ce3527023C75e7518C274A51ce712',
          isStableNg: true,
        },
      ],
      router: '0x4f37A9d177470499A2dD084621020b023fcffc1F', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xf3A6aa40cf048a3960E9664847E9a7be025a390a': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xf3A6aa40cf048a3960E9664847E9a7be025a390a',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.PLASMA]: {
      factories: [
        {
          address: '0x8271e06e5887fe5ba05234f5315c19f3ec90e8ad',
          isStableNg: true,
        },
      ],
      router: '0xff5cb29241f002ffed2eaa224e3e996d24a6e8d1',
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xfc687efafed297b765edecf8179c32195597c2df': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xfc687efafed297b765edecf8179c32195597c2df',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
    [Network.GNOSIS]: {
      factories: [
        {
          address: '0xbc0797015fcfc47d9c1856639cae50d0e69fbee8',
          isStableNg: true,
        },
      ],
      router: '0x0dcded3545d565ba3b19e683431381007245d983', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 5 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        // TODO-gnosis: check if there's no missing implementations
        '0x3d6cb2f6dcf47cdd9c13e4e3beae9af041d8796a': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0x3d6cb2f6dcf47cdd9c13e4e3beae9af041d8796a',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
        '0xc1b393efef38140662b91441c6710aa704973228': {
          name: ImplementationNames.FACTORY_STABLE_NG,
          address: '0xc1b393efef38140662b91441c6710aa704973228',
          liquidityApiSlug: '/factory-stable-ng',
          isStoreRateSupported: true,
        },
      },
      customPools: {},
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [
      {
        name: 'Adapter06',
        index: 2,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'BuyAdapter02',
        index: 6,
      },
    ],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [
      {
        name: 'PolygonAdapter03',
        index: 1,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'PolygonBuyAdapter',
        index: 11,
      },
    ],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [
      {
        name: 'ArbitrumAdapter03',
        index: 3,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'ArbitrumBuyAdapter',
        index: 13,
      },
    ],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [
      {
        name: 'OptimismAdapter02',
        index: 3,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'OptimismBuyAdapter',
        index: 9,
      },
    ],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [
      {
        name: 'BaseAdapter02',
        index: 4,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'BaseBuyAdapter',
        index: 10,
      },
    ],
  },
};

configAddressesNormalizer(CurveV1StableNgConfig);

export { CurveV1StableNgConfig };
