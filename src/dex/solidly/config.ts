import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const SolidlyConfig: DexConfigMap<DexParams> = {
  SolidlyV2: {
    [Network.MAINNET]: {
      factoryAddress: '0x777de5Fe8117cAAA7B44f396E93a401Cf5c9D4d6',
      router: '0x5b39e7A1C706464F5B3956b21CD22a43F0dB0eAC',
      subgraphURL: '4GX8RE9TzEWormbkayeGj4NQmmhYE46izVVUvXv8WPDh',
      initCode:
        '0x413d36e4ab9e83cf39b8064a3b5c98253a9e46a6cf02c8efd185314c866d656b',
      stableFee: 200, // This is not fixed
      volatileFee: 2000,
      feeCode: 0,
      poolGasCost: 220 * 1000, // https://dashboard.tenderly.co/paraswap/paraswap/tx/mainnet/0x80f01d841ac01cfaedc93ceaadc88fc799ee1539841c2ac19cfccfdcfb605d70/gas-usage
      feeFactor: 1e6,
    },
  },
  Dystopia: {
    [Network.POLYGON]: {
      subgraphURL: '89e9ZAHs7mJvpckEaSmpTtRXUsYcc1mesE7Czp1Hrqxa',
      factoryAddress: '0x1d21Db6cde1b18c7E47B0F7F42f4b3F68b9beeC9',
      router: '0xc8DB3501281c192fFE9697A1b905b161ca0cd64d',
      initCode:
        '0x009bce6d7eb00d3d075e5bd9851068137f44bba159f1cde806a268e20baaf2e8',
      // Fixed Fees, same for volatile and stable pools
      feeCode: 5,
      poolGasCost: 180 * 1000,
    },
  },
  Velodrome: {
    [Network.OPTIMISM]: {
      subgraphURL: '2bam2XEb91cFqABFPSKj3RiSjpop9HvDt1MnYq5cDX5E',
      factoryAddress: '0x25cbddb98b35ab1ff77413456b31ec81a6b6b746',
      router: '0xa2f581b012E0f2dcCDe86fCbfb529f4aC5dD4983',
      initCode:
        '0xc1ac28b1c4ebe53c0cff67bab5878c4eb68759bb1e9f73977cd266b247d149f0',
      // updatable fees on the factory without event
      stableFee: 5,
      volatileFee: 5,
      poolGasCost: 180 * 1000,
      feeCode: 5,
    },
  },
  VelodromeV2: {
    [Network.OPTIMISM]: {
      // RPC pool tracker is used
      factoryAddress: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
      router: '0xa2f581b012E0f2dcCDe86fCbfb529f4aC5dD4983',
      initCode:
        '0x1a8f01f7eab324003d9388f229ea17991eee9c9d14586f429799f3656790eba0',
      poolGasCost: 180 * 1000,
      feeCode: 0,
    },
  },
  Aerodrome: {
    [Network.BASE]: {
      // RPC pool tracker is used, as it inherits from VelodromeV2
      factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
      router: '0xDCf4EE5B700e2a5Fec458e06B763A4a3E3004494',
      subgraphURL: '7uEwiKmfbRQqV8Ec9nvdKrMFVFQv5qaM271gdBvHtywj',
      initCode:
        '0x1a8f01f7eab324003d9388f229ea17991eee9c9d14586f429799f3656790eba0',
      poolGasCost: 180 * 1000,
      feeCode: 0,
    },
  },
  Thena: {
    [Network.BSC]: {
      subgraphURL: 'FKEt2N5VmSdEYcz7fYLPvvnyEUkReQ7rvmXzs6tiKCz1',
      factoryAddress: '0xAFD89d21BdB66d00817d4153E055830B1c2B3970',
      router: '0xc2b5a8082D2E1867A9CBBF41b625E3ae9dF81f8b',
      initCode:
        '0x8d3d214c094a9889564f695c3e9fa516dd3b50bc3258207acd7f8b8e6b94fb65',
      stableFee: 1, // 10000 / 10000 = 1 in BPS
      volatileFee: 20, // 10000 / 500 = 20 in BPS
      poolGasCost: 180 * 1000,
      feeCode: 1,
    },
  },
  Chronos: {
    [Network.ARBITRUM]: {
      subgraphURL: 'BCCAQ3VvF4jLqCpr966QRRnAK8xpvv4MFJYHYCTv224r',
      factoryAddress: '0xce9240869391928253ed9cc9bcb8cb98cb5b0722',
      router: '0xb2634B3CBc1E401AB3C2743DB44d459C5c9aA662',
      initCode:
        '0x1840ae455256f509042de907fe0623f2e5e0ad44751ef974c4c37c1e516b7644',
      poolGasCost: 180 * 1000,
      feeCode: 0,
    },
  },
  Ramses: {
    [Network.ARBITRUM]: {
      subgraphURL: 'GdqerXoyuwHLq4DfTHomHJURu193L83ZeiynB4wbDfbW',
      factoryAddress: '0xAAA20D08e59F6561f242b08513D36266C5A29415',
      router: '0xb2634B3CBc1E401AB3C2743DB44d459C5c9aA662',
      initCode:
        '0x1565b129f2d1790f12d45301b9b084335626f0c92410bc43130763b69971135d',
      poolGasCost: 180 * 1000,
      feeCode: 0,
    },
  },
  PharaohV1: {
    [Network.AVALANCHE]: {
      // RPC pool tracker is used
      factoryAddress: '0xAAA16c016BF556fcD620328f0759252E29b1AB57',
      router: '0x609AcD8Fc955Dd7E744c7DFFc9930a7A6654DE43',
      initCode:
        '0xbf2404274de2b11f05e5aebd49e508de933034cb5fa2d0ac3de8cbd4bcef47dc',
      poolGasCost: 180 * 1000,
      stableFee: 5,
      volatileFee: 25,
      feeCode: 0,
    },
  },
  Equalizer: {
    [Network.BASE]: {
      // RPC pool tracker is used
      factoryAddress: '0xed8db60acc29e14bc867a497d94ca6e3ceb5ec04',
      router: '0xDCf4EE5B700e2a5Fec458e06B763A4a3E3004494',
      initCode:
        '0x7ba31a081e879b8e7f06d4e8bf5ee26b5c2680669c5701f4cdbdcde51727b275',
      feeCode: 0,
      feeFactor: 1e18,
      poolGasCost: 180 * 1000,
    },
  },
  Velocimeter: {
    [Network.BASE]: {
      // RPC pool tracker is used
      factoryAddress: '0xe21Aac7F113Bd5DC2389e4d8a8db854a87fD6951',
      router: '0xDCf4EE5B700e2a5Fec458e06B763A4a3E3004494',
      initCode:
        '0xac4013aa7118234c1dd1f9cc4cdd3933d5a426224bc691c1bde3d8930a7e6151', // PairFactory.pairCodeHash
      feeCode: 0, // dynamic fees
      poolGasCost: 180 * 1000, // just same as other forks
    },
  },
  Usdfi: {
    [Network.BSC]: {
      subgraphURL: 'EvFsjvtmZpMJ4Y5RdJCx9TD5AkQjXCKpWaTYUvZ2DpWM',
      factoryAddress: '0xB3863573d9f25e6a84895d4685a408db7a488416',
      router: '0xc2b5a8082D2E1867A9CBBF41b625E3ae9dF81f8b',
      initCode:
        '0x1d770cc32abcf060a45b0de3f0afbd8594effe9f6d836f93d19c05d76b4b4dfa',
      poolGasCost: 180 * 1000,
      feeCode: 0, // dynamic fees
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter02', index: 3 }], // dystopia
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter01', index: 8 }], // velodrome
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter02', index: 1 }], // thena + cone, usdFi
  },
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter04', index: 1 }], // solidly
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter02', index: 3 }], // solisnek (deprecated)
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter02', index: 1 }], // chronos, ramses
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 3 }], // aerodrome, equalizer, velocimeter
  },
};
