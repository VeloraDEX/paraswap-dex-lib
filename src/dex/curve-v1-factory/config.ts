import {
  CustomImplementationNames,
  CustomPoolConfig,
  DexParams,
  FactoryImplementationNames,
  FactoryPoolImplementations,
  ImplementationNames,
} from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';
import { normalizeAddress } from '../../utils';
import { FACTORY_MAX_PLAIN_COINS } from './constants';

// stable ng factories addresses are taken from https://github.com/curvefi/curve-api/blob/main/constants/configs/configs.js
const CurveV1FactoryConfig: DexConfigMap<DexParams> = {
  CurveV1Factory: {
    [Network.MAINNET]: {
      factories: [
        {
          address: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
        {
          address: '0x4f8846ae9380b90d2e71d5e3d042dff3e7ebb40d',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
      ],
      router: '0x16C6521Dff6baB339122a0FE25a9116693265353', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 5 * 1000,
      disabledPools: new Set([
        '0x28B0Cf1baFB707F2c6826d10caf6DD901a6540C5', // It is rug pool token
      ]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0x2f956eee002b0debd468cf2e0490d1aec65e027f': {
          name: ImplementationNames.FACTORY_V1_META_BTC,
          address: '0x2f956eee002b0debd468cf2e0490d1aec65e027f',
          basePoolAddress: '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714',
        },
        '0x5f890841f657d90e081babdb532a05996af79fe6': {
          name: ImplementationNames.FACTORY_V1_META_USD,
          address: '0x5f890841f657d90e081babdb532a05996af79fe6',
          basePoolAddress: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
        },
        '0xc6a8466d128fbfd34ada64a9fffce325d57c9a52': {
          name: ImplementationNames.FACTORY_META_BTC,
          address: '0xc6a8466d128fbfd34ada64a9fffce325d57c9a52',
          basePoolAddress: '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714',
        },
        '0xc4c78b08fa0c3d0a312605634461a88184ecd630': {
          name: ImplementationNames.FACTORY_META_BTC_BALANCES,
          address: '0xc4c78b08fa0c3d0a312605634461a88184ecd630',
          basePoolAddress: '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714',
        },
        '0xecaaecd9d2193900b424774133b1f51ae0f29d9e': {
          name: ImplementationNames.FACTORY_META_BTC_REN,
          address: '0xecaaecd9d2193900b424774133b1f51ae0f29d9e',
          basePoolAddress: '0x93054188d876f558f4a66B2EF1d97d16eDf0895B',
        },
        '0x40fd58d44cfe63e8517c9bb3ac98676838ea56a8': {
          name: ImplementationNames.FACTORY_META_BTC_BALANCES_REN,
          address: '0x40fd58d44cfe63e8517c9bb3ac98676838ea56a8',
          basePoolAddress: '0x93054188d876f558f4a66B2EF1d97d16eDf0895B',
        },
        '0x213be373fdff327658139c7df330817dad2d5bbe': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0x213be373fdff327658139c7df330817dad2d5bbe',
          basePoolAddress: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
        },
        '0x55aa9bf126bcabf0bdc17fa9e39ec9239e1ce7a9': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0x55aa9bf126bcabf0bdc17fa9e39ec9239e1ce7a9',
          basePoolAddress: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
        },
        '0x33bb0e62d5e8c688e645dd46dfb48cd613250067': {
          name: ImplementationNames.FACTORY_META_USD_FRAX_USDC,
          address: '0x33bb0e62d5e8c688e645dd46dfb48cd613250067',
          basePoolAddress: '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2',
        },
        '0x2eb24483ef551da247ab87cf18e1cc980073032d': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES_FRAX_USDC,
          address: '0x2eb24483ef551da247ab87cf18e1cc980073032d',
          basePoolAddress: '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2',
        },
        '0x008cfa89df5b0c780ca3462fc2602d7f8c7ac315': {
          name: ImplementationNames.FACTORY_META_BTC_SBTC2,
          address: '0x008cfa89df5b0c780ca3462fc2602d7f8c7ac315',
          basePoolAddress: '0xf253f83AcA21aAbD2A20553AE0BF7F65C755A07F',
        },
        '0xabc533ebcdded41215c46ee078c5818b5b0a252f': {
          name: ImplementationNames.FACTORY_META_BTC_BALANCES_SBTC2,
          address: '0xabc533ebcdded41215c46ee078c5818b5b0a252f',
          basePoolAddress: '0xf253f83AcA21aAbD2A20553AE0BF7F65C755A07F',
        },
        '0xc629a01ec23ab04e1050500a3717a2a5c0701497': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC_EMA,
          address: '0xc629a01ec23ab04e1050500a3717a2a5c0701497',
          customGasCost: 130_000,
        },
        '0x94b4dfd9ba5865cc931195c99a2db42f3fc5d45b': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH_EMA,
          address: '0x94b4dfd9ba5865cc931195c99a2db42f3fc5d45b',
          customGasCost: 130_000,
        },
        '0x847ee1227a9900b73aeeb3a47fac92c52fd54ed9': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH_EMA2,
          address: '0x847ee1227a9900b73aeeb3a47fac92c52fd54ed9',
          customGasCost: 130_000,
          isStoreRateSupported: true,
        },
        '0x1713141278648a4edd5b027fdbd448bb4a13ac0f': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH_EMA2,
          address: '0x1713141278648a4edd5b027fdbd448bb4a13ac0f',
          customGasCost: 130_000,
          isStoreRateSupported: true,
        },
        '0x24d937143d3f5cf04c72ba112735151a8cae2262': {
          name: ImplementationNames.FACTORY_PLAIN_2_BALANCES,
          address: '0x24d937143d3f5cf04c72ba112735151a8cae2262',
        },
        '0x6523ac15ec152cb70a334230f6c5d62c5bd963f1': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0x6523ac15ec152cb70a334230f6c5d62c5bd963f1',
        },
        '0x6326debbaa15bcfe603d831e7d75f4fc10d9b43e': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH,
          address: '0x6326debbaa15bcfe603d831e7d75f4fc10d9b43e',
        },
        '0x4a4d7868390ef5cac51cda262888f34bd3025c3f': {
          name: ImplementationNames.FACTORY_PLAIN_2_OPTIMIZED,
          address: '0x4a4d7868390ef5cac51cda262888f34bd3025c3f',
        },
        '0x50b085f2e5958c4a87baf93a8ab79f6bec068494': {
          name: ImplementationNames.FACTORY_PLAIN_3_BALANCES,
          address: '0x50b085f2e5958c4a87baf93a8ab79f6bec068494',
        },
        '0x9b52f13df69d79ec5aab6d1ace3157d29b409cc3': {
          name: ImplementationNames.FACTORY_PLAIN_3_BASIC,
          address: '0x9b52f13df69d79ec5aab6d1ace3157d29b409cc3',
        },
        '0x8c1ab78601c259e1b43f19816923609dc7d7de9b': {
          name: ImplementationNames.FACTORY_PLAIN_3_ETH,
          address: '0x8c1ab78601c259e1b43f19816923609dc7d7de9b',
        },
        '0xe5f4b89e0a16578b3e0e7581327bdb4c712e44de': {
          name: ImplementationNames.FACTORY_PLAIN_3_OPTIMIZED,
          address: '0xe5f4b89e0a16578b3e0e7581327bdb4c712e44de',
        },
        '0xd35B58386705CE75CE6d09842E38E9BE9CDe5bF6': {
          name: ImplementationNames.FACTORY_PLAIN_4_BALANCES,
          address: '0xd35B58386705CE75CE6d09842E38E9BE9CDe5bF6',
        },
        '0x5bd47ea4494e0f8de6e3ca10f1c05f55b72466b8': {
          name: ImplementationNames.FACTORY_PLAIN_4_BASIC,
          address: '0x5bd47ea4494e0f8de6e3ca10f1c05f55b72466b8',
        },
        '0x88855cdF2b0A8413D470B86952E726684de915be': {
          name: ImplementationNames.FACTORY_PLAIN_4_ETH,
          address: '0x88855cdF2b0A8413D470B86952E726684de915be',
        },
        '0xad4753d045d3aed5c1a6606dfb6a7d7ad67c1ad7': {
          name: ImplementationNames.FACTORY_PLAIN_4_OPTIMIZED,
          address: '0xad4753d045d3aed5c1a6606dfb6a7d7ad67c1ad7',
        },
        '0x67fe41A94e779CcFa22cff02cc2957DC9C0e4286': {
          name: ImplementationNames.FACTORY_PLAIN_2_CRV_EMA,
          address: '0x67fe41A94e779CcFa22cff02cc2957DC9C0e4286',
          liquidityApiSlug: '/factory-crvusd',
        },
      },
      customPools: {
        '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2': {
          name: CustomImplementationNames.CUSTOM_PLAIN_2COIN_FRAX,
          address: '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2',
          lpTokenAddress: '0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
        '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714': {
          name: CustomImplementationNames.CUSTOM_PLAIN_3COIN_SBTC,
          address: '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714',
          lpTokenAddress: '0x075b1bb99792c9E1041bA13afEf80C91a1e70fB3',
          liquidityApiSlug: '/main',
          coinsInputType: 'int128',
          balancesInputType: 'int128',
          useForPricing: false,
        },
        '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7': {
          name: CustomImplementationNames.CUSTOM_PLAIN_3COIN_THREE,
          address: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
          lpTokenAddress: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
        '0x93054188d876f558f4a66B2EF1d97d16eDf0895B': {
          name: CustomImplementationNames.CUSTOM_PLAIN_2COIN_RENBTC,
          address: '0x93054188d876f558f4a66B2EF1d97d16eDf0895B',
          lpTokenAddress: '0x49849C98ae39Fff122806C06791Fa73784FB3675',
          liquidityApiSlug: '/main',
          coinsInputType: 'int128',
          balancesInputType: 'int128',
          useForPricing: false,
        },
        '0xf253f83aca21aabd2a20553ae0bf7f65c755a07f': {
          name: CustomImplementationNames.CUSTOM_PLAIN_2COIN_WBTC,
          address: '0xf253f83aca21aabd2a20553ae0bf7f65c755a07f',
          lpTokenAddress: '0x051d7e5609917Bd9b73f04BAc0DED8Dd46a74301',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: true,
        },
      },
    },
    [Network.POLYGON]: {
      factories: [
        {
          address: '0x722272D36ef0Da72FF51c5A65Db7b870E2e8D4ee',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
      ],
      router: '0x0DCDED3545D565bA3B19E683431381007245d983', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([
        '0x666Dc3b4baBfd063FaF965BD020024AF0dC51B64',
        '0x88C4D6534165510b2E2CAF0A130d4F70aA4B6d71',
        '0xE4199bC5C5C1F63dbA47B56B6dB7144C51CF0bF8',
        '0xdaedd59fa2c5c63d46a3bae5ed115247df9eb6ec',
        '0x3ce39825ab258693cedb8daf1db441627d011371',
        '0x632F9Be4Bf42e0dBb461CFcC0CF788538a49ED6D',
        '0x1197Ae7F43695Be80127365b494E8BF850f4752A',
        '0x40caB7C05fc1686e198C8d6d6aA4aaCF77BE8590',
        '0x64FFf0e27c223097c824f9d9278eFD5B55c3430e',
      ]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0x571FF5b7b346F706aa48d696a9a4a288e9Bb4091': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0x571FF5b7b346F706aa48d696a9a4a288e9Bb4091',
        },
        '0x8925D9d9B4569D737a48499DeF3f67BaA5a144b9': {
          name: ImplementationNames.FACTORY_PLAIN_2_BALANCES,
          address: '0x8925D9d9B4569D737a48499DeF3f67BaA5a144b9',
        },
        '0xAe00f57663F4C85FC948B13963cd4627dAF01061': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH,
          address: '0xAe00f57663F4C85FC948B13963cd4627dAF01061',
        },
        '0x8101e6760130be2c8ace79643ab73500571b7162': {
          name: ImplementationNames.FACTORY_PLAIN_2_OPTIMIZED,
          address: '0x8101e6760130be2c8ace79643ab73500571b7162',
        },
        '0x493084ca44c779af27a416ac1f71e3823bf21b53': {
          name: ImplementationNames.FACTORY_PLAIN_3_BASIC,
          address: '0x493084ca44c779af27a416ac1f71e3823bf21b53',
        },
        '0x9b4ed6f8904e976146b3dc0233cd48cf81835240': {
          name: ImplementationNames.FACTORY_PLAIN_3_BALANCES,
          address: '0x9b4ed6f8904e976146b3dc0233cd48cf81835240',
        },
        '0xa9134fae98f92217f457918505375ae91fdc5e3c': {
          name: ImplementationNames.FACTORY_PLAIN_3_ETH,
          address: '0xa9134fae98f92217f457918505375ae91fdc5e3c',
        },
        '0xcc9fd96c26c450dd4580893aff75efd5cb6c12fc': {
          name: ImplementationNames.FACTORY_PLAIN_3_OPTIMIZED,
          address: '0xcc9fd96c26c450dd4580893aff75efd5cb6c12fc',
        },
        '0x991b05d5316fa3a2c053f84658b84987cd5c9970': {
          name: ImplementationNames.FACTORY_PLAIN_4_BASIC,
          address: '0x991b05d5316fa3a2c053f84658b84987cd5c9970',
        },
        '0xC7c46488566b9ef9B981b87E328939CaA5ca152f': {
          name: ImplementationNames.FACTORY_PLAIN_4_BALANCES,
          address: '0xC7c46488566b9ef9B981b87E328939CaA5ca152f',
        },
        '0xf31bcdf0b9a5ecd7ab463eb905551fbc32e51856': {
          name: ImplementationNames.FACTORY_PLAIN_4_ETH,
          address: '0xf31bcdf0b9a5ecd7ab463eb905551fbc32e51856',
        },
        '0xAc273d5b4FC06625d8b1abA3BE8De15bDFb8E39f': {
          name: ImplementationNames.FACTORY_PLAIN_4_OPTIMIZED,
          address: '0xAc273d5b4FC06625d8b1abA3BE8De15bDFb8E39f',
        },
        '0x4fb93D7d320E8A263F22f62C2059dFC2A8bCbC4c': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0x4fb93D7d320E8A263F22f62C2059dFC2A8bCbC4c',
          basePoolAddress: '0x445FE580eF8d70FF569aB36e80c647af338db351',
        },
        '0x39fE1824f98CD828050D7c51dA443E84121c7cf1': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0x39fE1824f98CD828050D7c51dA443E84121c7cf1',
          basePoolAddress: '0x445FE580eF8d70FF569aB36e80c647af338db351',
        },
        '0xC05EB760A135d3D0c839f1141423002681157a17': {
          name: ImplementationNames.FACTORY_META_BTC,
          address: '0xC05EB760A135d3D0c839f1141423002681157a17',
          basePoolAddress: '0xC2d95EEF97Ec6C17551d45e77B590dc1F9117C67',
        },
        '0xD8336532f6ED7b94282fAF724fe41d6145E07Cfc': {
          name: ImplementationNames.FACTORY_META_BTC_BALANCES,
          address: '0xD8336532f6ED7b94282fAF724fe41d6145E07Cfc',
          basePoolAddress: '0xC2d95EEF97Ec6C17551d45e77B590dc1F9117C67',
        },
      },
      customPools: {
        '0x445FE580eF8d70FF569aB36e80c647af338db351': {
          name: CustomImplementationNames.CUSTOM_POLYGON_3COIN_LENDING,
          address: '0x445FE580eF8d70FF569aB36e80c647af338db351',
          lpTokenAddress: '0xe7a24ef0c5e95ffb0f6684b813a78f2a3ad7d171',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
        '0xC2d95EEF97Ec6C17551d45e77B590dc1F9117C67': {
          name: CustomImplementationNames.CUSTOM_POLYGON_2COIN_LENDING,
          address: '0xC2d95EEF97Ec6C17551d45e77B590dc1F9117C67',
          lpTokenAddress: '0xf8a57c1d3b9629b77b6726a042ca48990a84fb49',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
      },
    },
    [Network.AVALANCHE]: {
      factories: [
        {
          address: '0xb17b674D9c5CB2e441F8e196a2f048A81355d031',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
      ],
      router: '0x0DCDED3545D565bA3B19E683431381007245d983', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      // FIX: This must be removed when we go for full CurveV1 event based support
      disabledPools: new Set(['0x16a7da911a4dd1d83f3ff066fe28f3c792c50d90']),
      disabledImplementations: new Set([
        '0xa27f39e9c21b3376f43266e13ad5a5d6e9bdb320',
        '0x505c34ed8dbe96d2d5c7d83158aa844887770970',
      ]),
      factoryPoolImplementations: {
        '0x697434ca761d4f86b553784b69f4f37f5edf54df': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0x697434ca761d4f86b553784b69f4f37f5edf54df',
        },
        '0xbdff0c27dd073c119ebcb1299a68a6a92ae607f0': {
          name: ImplementationNames.FACTORY_PLAIN_2_BALANCES,
          address: '0xbdff0c27dd073c119ebcb1299a68a6a92ae607f0',
        },
        '0x64448B78561690B70E17CBE8029a3e5c1bB7136e': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH,
          address: '0x64448B78561690B70E17CBE8029a3e5c1bB7136e',
        },
        '0x09672362833d8f703D5395ef3252D4Bfa51c15ca': {
          name: ImplementationNames.FACTORY_PLAIN_2_OPTIMIZED,
          address: '0x09672362833d8f703D5395ef3252D4Bfa51c15ca',
        },
        '0x1de7f0866e2c4adAC7b457c58Cc25c8688CDa1f2': {
          name: ImplementationNames.FACTORY_PLAIN_3_BASIC,
          address: '0x1de7f0866e2c4adAC7b457c58Cc25c8688CDa1f2',
        },
        '0x094d12e5b541784701FD8d65F11fc0598FBC6332': {
          name: ImplementationNames.FACTORY_PLAIN_3_BALANCES,
          address: '0x094d12e5b541784701FD8d65F11fc0598FBC6332',
        },
        '0xf1f85a74ad6c64315f85af52d3d46bf715236adc': {
          name: ImplementationNames.FACTORY_PLAIN_3_ETH,
          address: '0xf1f85a74ad6c64315f85af52d3d46bf715236adc',
        },
        '0xaa82ca713d94bba7a89ceab55314f9effeddc78c': {
          name: ImplementationNames.FACTORY_PLAIN_3_OPTIMIZED,
          address: '0xaa82ca713d94bba7a89ceab55314f9effeddc78c',
        },
        '0x7544Fe3d184b6B55D6B36c3FCA1157eE0Ba30287': {
          name: ImplementationNames.FACTORY_PLAIN_4_BASIC,
          address: '0x7544Fe3d184b6B55D6B36c3FCA1157eE0Ba30287',
        },
        '0x7d86446ddb609ed0f5f8684acf30380a356b2b4c': {
          name: ImplementationNames.FACTORY_PLAIN_4_BALANCES,
          address: '0x7d86446ddb609ed0f5f8684acf30380a356b2b4c',
        },
        '0x0eb0F1FaF5F509Ac53fA224477509EAD167cf410': {
          name: ImplementationNames.FACTORY_PLAIN_4_ETH,
          address: '0x0eb0F1FaF5F509Ac53fA224477509EAD167cf410',
        },
        '0xCE94D3E5b0D80565D7B713A687b39a3Dc81780BA': {
          name: ImplementationNames.FACTORY_PLAIN_4_OPTIMIZED,
          address: '0xCE94D3E5b0D80565D7B713A687b39a3Dc81780BA',
        },
        '0xa237034249290de2b07988ac64b96f22c0e76fe0': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0xa237034249290de2b07988ac64b96f22c0e76fe0',
          basePoolAddress: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
        },
        '0xc50c05ca1f8c2346664bd0d4a1eb6ac1da38414f': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0xc50c05ca1f8c2346664bd0d4a1eb6ac1da38414f',
          basePoolAddress: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
        },
      },
      customPools: {
        '0x7f90122BF0700F9E7e1F688fe926940E8839F353': {
          name: CustomImplementationNames.CUSTOM_AVALANCHE_3COIN_LENDING,
          address: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
          lpTokenAddress: '0x1337BedC9D22ecbe766dF105c9623922A27963EC',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
      },
    },
    [Network.ARBITRUM]: {
      factories: [
        {
          address: '0xb17b674D9c5CB2e441F8e196a2f048A81355d031',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
      ],
      router: '0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0x54e8A25d0Ac0E4945b697C80b8372445FEA17A62': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0x54e8A25d0Ac0E4945b697C80b8372445FEA17A62',
        },
        '0xD68970e266cE1A015953897C7055a5E0bC657Af8': {
          name: ImplementationNames.FACTORY_PLAIN_2_BALANCES,
          address: '0xD68970e266cE1A015953897C7055a5E0bC657Af8',
        },
        '0x7DA64233Fefb352f8F501B357c018158ED8aA455': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH,
          address: '0x7DA64233Fefb352f8F501B357c018158ED8aA455',
        },
        '0x0100fBf414071977B19fC38e6fc7c32FE444F5C9': {
          name: ImplementationNames.FACTORY_PLAIN_2_OPTIMIZED,
          address: '0x0100fBf414071977B19fC38e6fc7c32FE444F5C9',
        },
        '0xe381C25de995d62b453aF8B931aAc84fcCaa7A62': {
          name: ImplementationNames.FACTORY_PLAIN_3_BASIC,
          address: '0xe381C25de995d62b453aF8B931aAc84fcCaa7A62',
        },
        '0xc379bA7b8e1c6C48D64e1cf9dD602C97c9fD0F40': {
          name: ImplementationNames.FACTORY_PLAIN_3_BALANCES,
          address: '0xc379bA7b8e1c6C48D64e1cf9dD602C97c9fD0F40',
        },
        '0xAAe75FAebCae43b9d541Fd875622BE48D9B4f5D0': {
          name: ImplementationNames.FACTORY_PLAIN_3_ETH,
          address: '0xAAe75FAebCae43b9d541Fd875622BE48D9B4f5D0',
        },
        '0x8866414733F22295b7563f9C5299715D2D76CAf4': {
          name: ImplementationNames.FACTORY_PLAIN_3_OPTIMIZED,
          address: '0x8866414733F22295b7563f9C5299715D2D76CAf4',
        },
        '0x8d53E5De033078367Ad91527c53abfd1Eb6bfa86': {
          name: ImplementationNames.FACTORY_PLAIN_4_BASIC,
          address: '0x8d53E5De033078367Ad91527c53abfd1Eb6bfa86',
        },
        '0x2ac56cEBc2D27c9bB51a11773355E44371Eb88D3': {
          name: ImplementationNames.FACTORY_PLAIN_4_BALANCES,
          address: '0x2ac56cEBc2D27c9bB51a11773355E44371Eb88D3',
        },
        '0x89287c32c2CAC1C76227F6d300B2DBbab6b75C08': {
          name: ImplementationNames.FACTORY_PLAIN_4_ETH,
          address: '0x89287c32c2CAC1C76227F6d300B2DBbab6b75C08',
        },
        '0x06e3C4da96fd076b97b7ca3Ae23527314b6140dF': {
          name: ImplementationNames.FACTORY_PLAIN_4_OPTIMIZED,
          address: '0x06e3C4da96fd076b97b7ca3Ae23527314b6140dF',
        },
        '0x09672362833d8f703D5395ef3252D4Bfa51c15ca': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0x09672362833d8f703D5395ef3252D4Bfa51c15ca',
          basePoolAddress: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
        },
        '0xBE175115BF33E12348ff77CcfEE4726866A0Fbd5': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0xBE175115BF33E12348ff77CcfEE4726866A0Fbd5',
          basePoolAddress: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
        },
        '0x8DEb66a4A40E370355bEe35f12E55Fe9c755d686': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0x8DEb66a4A40E370355bEe35f12E55Fe9c755d686',
          basePoolAddress: '0xC9B8a3FDECB9D5b218d02555a8Baf332E5B740d5',
        },
        '0x3edE9b145F82e9e46C03f8A8F67B77aEE847b632': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0x3edE9b145F82e9e46C03f8A8F67B77aEE847b632',
          basePoolAddress: '0xC9B8a3FDECB9D5b218d02555a8Baf332E5B740d5',
        },
        '0x094d12e5b541784701FD8d65F11fc0598FBC6332': {
          name: ImplementationNames.FACTORY_META_BTC,
          address: '0x094d12e5b541784701FD8d65F11fc0598FBC6332',
          basePoolAddress: '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb',
        },
        '0xF1f85a74AD6c64315F85af52d3d46bF715236ADc': {
          name: ImplementationNames.FACTORY_META_BTC_BALANCES,
          address: '0xF1f85a74AD6c64315F85af52d3d46bF715236ADc',
          basePoolAddress: '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb',
        },
        '0x73ec37618683c274d0bbf5f5726aa856b2bdab81': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC_EMA,
          address: '0x73ec37618683c274d0bbf5f5726aa856b2bdab81',
          customGasCost: 130_000,
        },
        '0x6f9fb833501f46cbe6f6a4b6cf32c834e5a5e8c5': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH_EMA2,
          address: '0x6f9fb833501f46cbe6f6a4b6cf32c834e5a5e8c5',
          customGasCost: 130_000,
          isStoreRateSupported: true,
        },
      },
      customPools: {
        '0x7f90122BF0700F9E7e1F688fe926940E8839F353': {
          name: CustomImplementationNames.CUSTOM_ARBITRUM_2COIN_USD,
          address: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
          lpTokenAddress: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
        '0xC9B8a3FDECB9D5b218d02555a8Baf332E5B740d5': {
          name: FactoryImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0xC9B8a3FDECB9D5b218d02555a8Baf332E5B740d5',
          lpTokenAddress: '0xC9B8a3FDECB9D5b218d02555a8Baf332E5B740d5',
          liquidityApiSlug: '/factory',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
        '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb': {
          name: CustomImplementationNames.CUSTOM_ARBITRUM_2COIN_BTC,
          address: '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb',
          lpTokenAddress: '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
      },
    },
    [Network.OPTIMISM]: {
      factories: [
        {
          address: '0x2db0E83599a91b508Ac268a6197b8B14F5e72840',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
      ],
      router: '0x0DCDED3545D565bA3B19E683431381007245d983', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xC2b1DF84112619D190193E48148000e3990Bf627': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0xC2b1DF84112619D190193E48148000e3990Bf627',
        },
        '0x16a7DA911A4DD1d83F3fF066fE28F3C792C50d90': {
          name: ImplementationNames.FACTORY_PLAIN_2_BALANCES,
          address: '0x16a7DA911A4DD1d83F3fF066fE28F3C792C50d90',
        },
        '0x4f3E8F405CF5aFC05D68142F3783bDfE13811522': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH,
          address: '0x4f3E8F405CF5aFC05D68142F3783bDfE13811522',
        },
        '0x0f9cb53Ebe405d49A0bbdBD291A65Ff571bC83e1': {
          name: ImplementationNames.FACTORY_PLAIN_2_OPTIMIZED,
          address: '0x0f9cb53Ebe405d49A0bbdBD291A65Ff571bC83e1',
        },
        '0x78D0fC2B9D5AE65512DB242e424a9c683F18c243': {
          name: ImplementationNames.FACTORY_PLAIN_3_BASIC,
          address: '0x78D0fC2B9D5AE65512DB242e424a9c683F18c243',
        },
        '0x35796DAc54f144DFBAD1441Ec7C32313A7c29F39': {
          name: ImplementationNames.FACTORY_PLAIN_3_BALANCES,
          address: '0x35796DAc54f144DFBAD1441Ec7C32313A7c29F39',
        },
        '0x6600e98b71dabfD4A8Cac03b302B0189Adb86Afb': {
          name: ImplementationNames.FACTORY_PLAIN_3_ETH,
          address: '0x6600e98b71dabfD4A8Cac03b302B0189Adb86Afb',
        },
        '0x6D65b498cb23deAba52db31c93Da9BFFb340FB8F': {
          name: ImplementationNames.FACTORY_PLAIN_3_OPTIMIZED,
          address: '0x6D65b498cb23deAba52db31c93Da9BFFb340FB8F',
        },
        '0x445FE580eF8d70FF569aB36e80c647af338db351': {
          name: ImplementationNames.FACTORY_PLAIN_4_BASIC,
          address: '0x445FE580eF8d70FF569aB36e80c647af338db351',
        },
        '0xF6bDc2619FFDA72c537Cd9605e0A274Dc48cB1C9': {
          name: ImplementationNames.FACTORY_PLAIN_4_BALANCES,
          address: '0xF6bDc2619FFDA72c537Cd9605e0A274Dc48cB1C9',
        },
        '0x1AEf73d49Dedc4b1778d0706583995958Dc862e6': {
          name: ImplementationNames.FACTORY_PLAIN_4_ETH,
          address: '0x1AEf73d49Dedc4b1778d0706583995958Dc862e6',
        },
        '0x8474DdbE98F5aA3179B3B3F5942D724aFcdec9f6': {
          name: ImplementationNames.FACTORY_PLAIN_4_OPTIMIZED,
          address: '0x8474DdbE98F5aA3179B3B3F5942D724aFcdec9f6',
        },
        '0x78CF256256C8089d68Cde634Cf7cDEFb39286470': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0x78CF256256C8089d68Cde634Cf7cDEFb39286470',
          basePoolAddress: '0x1337BedC9D22ecbe766dF105c9623922A27963EC',
        },
        '0xADf698e4d8Df08b3E2c79682891636eF00F6e205': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0xADf698e4d8Df08b3E2c79682891636eF00F6e205',
          basePoolAddress: '0x1337BedC9D22ecbe766dF105c9623922A27963EC',
        },
        '0xe8269B33E47761f552E1a3070119560d5fa8bBD6': {
          name: ImplementationNames.FACTORY_META_USD,
          address: '0xe8269B33E47761f552E1a3070119560d5fa8bBD6',
          basePoolAddress: '0x29A3d66B30Bc4AD674A4FDAF27578B64f6afbFe7',
        },
        '0x114C4042B11a2b16F58Fe1BFe847589a122F678a': {
          name: ImplementationNames.FACTORY_META_USD_BALANCES,
          address: '0x114C4042B11a2b16F58Fe1BFe847589a122F678a',
          basePoolAddress: '0x29A3d66B30Bc4AD674A4FDAF27578B64f6afbFe7',
        },
        '0x73ec37618683c274d0bbf5f5726aa856b2bdab81': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC_EMA,
          address: '0x73ec37618683c274d0bbf5f5726aa856b2bdab81',
          customGasCost: 130_000,
        },
        '0x6f9fb833501f46cbe6f6a4b6cf32c834e5a5e8c5': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH_EMA2,
          address: '0x6f9fb833501f46cbe6f6a4b6cf32c834e5a5e8c5',
          customGasCost: 130_000,
          isStoreRateSupported: true,
        },
      },
      customPools: {
        '0x1337BedC9D22ecbe766dF105c9623922A27963EC': {
          name: CustomImplementationNames.CUSTOM_OPTIMISM_3COIN_USD,
          address: '0x1337BedC9D22ecbe766dF105c9623922A27963EC',
          lpTokenAddress: '0x1337BedC9D22ecbe766dF105c9623922A27963EC',
          liquidityApiSlug: '/main',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
        '0x29A3d66B30Bc4AD674A4FDAF27578B64f6afbFe7': {
          name: FactoryImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0x29A3d66B30Bc4AD674A4FDAF27578B64f6afbFe7',
          lpTokenAddress: '0x29A3d66B30Bc4AD674A4FDAF27578B64f6afbFe7',
          liquidityApiSlug: '/factory',
          coinsInputType: 'uint256',
          balancesInputType: 'uint256',
          useForPricing: false,
        },
      },
    },
    [Network.BASE]: {
      factories: [
        {
          address: '0x3093f9B57A428F3EB6285a589cb35bEA6e78c336',
          maxPlainCoins: FACTORY_MAX_PLAIN_COINS,
        },
      ],
      router: '0x4f37A9d177470499A2dD084621020b023fcffc1F', // https://github.com/curvefi/curve-router-ng
      stateUpdatePeriodMs: 2 * 1000,
      disabledPools: new Set([]),
      disabledImplementations: new Set([]),
      factoryPoolImplementations: {
        '0xD166EEdf272B860E991d331B71041799379185D5': {
          name: ImplementationNames.FACTORY_PLAIN_2_BASIC,
          address: '0xD166EEdf272B860E991d331B71041799379185D5',
        },
        '0x5C627d6925e448Ae418BC8a45d56B31fe5009Bea': {
          name: ImplementationNames.FACTORY_PLAIN_2_BALANCES,
          address: '0x5C627d6925e448Ae418BC8a45d56B31fe5009Bea',
        },
        '0x0Cc51c9786f3777a6d50961CEBb2BB6E69ec5e07': {
          name: ImplementationNames.FACTORY_PLAIN_3_BALANCES,
          address: '0x0Cc51c9786f3777a6d50961CEBb2BB6E69ec5e07',
        },
        '0x22d710931f01c1681ca1570ff016ed42eb7b7c2a': {
          name: ImplementationNames.FACTORY_PLAIN_2_ETH,
          address: '0x22d710931f01c1681ca1570ff016ed42eb7b7c2a',
        },
        '0x1621E58d36EB5Ef26F9768Ebe9DB77181b1f5a02': {
          name: ImplementationNames.FACTORY_PLAIN_4_BASIC,
          address: '0x1621E58d36EB5Ef26F9768Ebe9DB77181b1f5a02',
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
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [
      {
        name: 'AvalancheAdapter02',
        index: 8,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'AvalancheBuyAdapter',
        index: 10,
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

// This become quite ugly :(
// I just wanted to make sure that every address is lowercased and it is not missed it config changes at some point
export const configAddressesNormalizer = (
  config: DexConfigMap<DexParams>,
): DexConfigMap<DexParams> => {
  for (const dexKey of Object.keys(config)) {
    for (const network of Object.keys(config[dexKey])) {
      const _config = config[dexKey][+network];

      // Normalize custom pool fields
      Object.keys(_config.customPools).forEach(p => {
        _config.customPools[p].address =
          _config.customPools[p].address.toLowerCase();
        _config.customPools[p].lpTokenAddress =
          _config.customPools[p].lpTokenAddress.toLowerCase();
      });

      const customPools = Object.entries(_config.customPools).reduce<
        Record<string, CustomPoolConfig>
      >((acc, [customPoolAddress, customPoolConfig]) => {
        const normalizedImplementation: CustomPoolConfig = {
          name: customPoolConfig.name,
          liquidityApiSlug: customPoolConfig.liquidityApiSlug,
          coinsInputType: customPoolConfig.coinsInputType,
          balancesInputType: customPoolConfig.balancesInputType,
          address: normalizeAddress(customPoolConfig.address),
          lpTokenAddress: normalizeAddress(customPoolConfig.lpTokenAddress),
          useForPricing: customPoolConfig.useForPricing,
        };
        acc[normalizeAddress(customPoolAddress)] = normalizedImplementation;
        return acc;
      }, {});

      // Had to recreate object to change key to lower case
      const factoryPoolImplementations = Object.entries(
        _config.factoryPoolImplementations,
      ).reduce<Record<string, FactoryPoolImplementations>>(
        (acc, [implementationAddress, implementationConfig]) => {
          const normalizedImplementation: FactoryPoolImplementations = {
            name: implementationConfig.name,
            address: normalizeAddress(implementationConfig.address),
            basePoolAddress: implementationConfig.basePoolAddress
              ? normalizeAddress(implementationConfig.basePoolAddress)
              : undefined,
            isStoreRateSupported: implementationConfig.isStoreRateSupported,
            liquidityApiSlug: implementationConfig.liquidityApiSlug,
          };
          acc[normalizeAddress(implementationAddress)] =
            normalizedImplementation;
          return acc;
        },
        {},
      );

      // Unite everything into top level config
      const normalizedConfig: DexParams = {
        factories: _config.factories
          ? _config.factories.map(e => ({
              ...e,
              address: e.address.toLowerCase(),
            }))
          : _config.factories,
        router: _config.router,
        stateUpdatePeriodMs: _config.stateUpdatePeriodMs,
        factoryPoolImplementations,
        customPools,
        disabledPools: new Set(
          Array.from(_config.disabledPools).map(normalizeAddress),
        ),
        disabledImplementations: new Set(
          Array.from(_config.disabledImplementations).map(normalizeAddress),
        ),
      };
      config[dexKey][+network] = normalizedConfig;
    }
  }
  return config;
};

configAddressesNormalizer(CurveV1FactoryConfig);

export { CurveV1FactoryConfig };
