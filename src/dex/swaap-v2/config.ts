import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const SwaapV2Config: DexConfigMap<DexParams> = {
  SwaapV2: {
    [Network.MAINNET]: {},
    [Network.POLYGON]: {},
    [Network.ARBITRUM]: {},
    [Network.BASE]: {},
    [Network.BSC]: {},
    [Network.OPTIMISM]: {},
    [Network.AVALANCHE]: {},
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter04', index: 3 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 10 }],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter02', index: 8 }],
    [SwapSide.BUY]: [{ name: 'PolygonBuyAdapter', index: 7 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter02', index: 6 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter', index: 8 }],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter02', index: 1 }],
    [SwapSide.BUY]: [{ name: 'BaseBuyAdapter', index: 8 }],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter02', index: 11 }],
    [SwapSide.BUY]: [{ name: 'BscBuyAdapter', index: 9 }],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter02', index: 2 }],
    [SwapSide.BUY]: [{ name: 'OptimismBuyAdapter', index: 7 }],
  },
};
