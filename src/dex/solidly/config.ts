import { AbiItem } from 'web3-utils';
import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';
import AerodromeFactoryABI from '../../abi/aerodrome/aerodrome-pool-factory.json';

export const SolidlyConfig: DexConfigMap<DexParams> = {
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
      factoryAbi: AerodromeFactoryABI as AbiItem[],
      getPairMethodName: 'getPool',
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
  Blackhole: {
    [Network.AVALANCHE]: {
      // RPC pool tracker is used
      factoryAddress: '0xfE926062Fb99CA5653080d6C14fE945Ad68c265C',
      router: '0xCaD684775d7879E63f5d319dAcC8086EeCC01B01',
      initCode:
        '0x87b2d661db12ce27ece6305198fcb950a2522c8e43e3b90e93256b71a6db5899',
      poolGasCost: 180 * 1000,
      feeCode: 0, // dynamic fees
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter01', index: 8 }], // velodrome
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter02', index: 1 }], // thena
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter02', index: 3 }], // blackhole
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter02', index: 1 }], // ramses
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 3 }], // aerodrome, equalizer
  },
};
