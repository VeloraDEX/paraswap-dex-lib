import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const DexalotConfig: DexConfigMap<DexParams> = {
  Dexalot: {
    [Network.AVALANCHE]: {
      dexalotRouterAddress: '0x3D3E4F0523500f95039D0Fe600ACf2ADE4b06eB9',
    },
    [Network.ARBITRUM]: {
      dexalotRouterAddress: '0x3D3E4F0523500f95039D0Fe600ACf2ADE4b06eB9',
    },
    [Network.BASE]: {
      dexalotRouterAddress: '0x3D3E4F0523500f95039D0Fe600ACf2ADE4b06eB9',
    },
    [Network.BSC]: {
      dexalotRouterAddress: '0x3D3E4F0523500f95039D0Fe600ACf2ADE4b06eB9',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter02', index: 6 }],
    [SwapSide.BUY]: [{ name: 'AvalancheBuyAdapter', index: 8 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter03', index: 2 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter', index: 11 }],
  },
};
