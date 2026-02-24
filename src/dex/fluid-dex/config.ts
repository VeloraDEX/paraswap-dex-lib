import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const FluidDexConfig: DexConfigMap<DexParams> = {
  FluidDex: {
    [Network.MAINNET]: {
      commonAddresses: {
        liquidityProxy: '0x52aa899454998be5b000ad077a46bbe360f4e497',
        resolver: '0xC93876C0EEd99645DD53937b25433e311881A27C',
        dexFactory: '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085',
      },
    },
    [Network.BSC]: {
      commonAddresses: {
        liquidityProxy: '0x52Aa899454998Be5b000Ad077a46Bbe360F4e497',
        resolver: '0x05Bd8269A20C472b148246De20E6852091BF16Ff',
        dexFactory: '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085',
      },
    },
    [Network.ARBITRUM]: {
      commonAddresses: {
        liquidityProxy: '0x52Aa899454998Be5b000Ad077a46Bbe360F4e497',
        resolver: '0x666A400b8cDA0Dc9b59D61706B0F982dDdAF2d98',
        dexFactory: '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085',
      },
    },
    [Network.POLYGON]: {
      commonAddresses: {
        liquidityProxy: '0x52Aa899454998Be5b000Ad077a46Bbe360F4e497',
        resolver: '0x18DeDd1cF3Af3537D4e726D2Aa81004D65DA8581',
        dexFactory: '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085',
      },
    },
    [Network.BASE]: {
      commonAddresses: {
        liquidityProxy: '0x52Aa899454998Be5b000Ad077a46Bbe360F4e497',
        resolver: '0x41E6055a282F8b7Abdb8D22Bcd85c2A0eE22e38A',
        dexFactory: '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085',
      },
    },
    [Network.PLASMA]: {
      commonAddresses: {
        liquidityProxy: '0x52Aa899454998Be5b000Ad077a46Bbe360F4e497',
        resolver: '0x2e28FBdE85512086bF2f61477274646c06b2032b',
        dexFactory: '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085',
      },
    },
  },
};

// Uniswap takes total gas of 125k = 21k base gas & 104k swap (this is when user has token balance)
// Fluid takes total gas of 175k = 21k base gas & 154k swap (this is when user has token balance),
// with ETH swaps costing less (because no WETH conversion)
export const FLUID_DEX_GAS_COST = 154_000;
