import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const DexalotConfig: DexConfigMap<DexParams> = {
  Dexalot: {
    [Network.AVALANCHE]: {
      dexalotRouterAddress: '0xf00240e5256e72771b46d095666594E0f40D085c',
    },
    [Network.ARBITRUM]: {
      dexalotRouterAddress: '0xf00240e5256e72771b46d095666594E0f40D085c',
    },
    [Network.BASE]: {
      dexalotRouterAddress: '0xf00240e5256e72771b46d095666594E0f40D085c',
    },
    [Network.BSC]: {
      dexalotRouterAddress: '0xf00240e5256e72771b46d095666594E0f40D085c',
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
