import { Network, SwapSide } from '../../constants';
import { AdapterMappings, DexConfigMap } from '../../types';
import { DexParams } from './types';

export const HashflowConfig: DexConfigMap<DexParams> = {
  Hashflow: {
    [Network.MAINNET]: {
      routerAddress: '0x55084eE0fEf03f14a305cd24286359A35D735151',
    },
    [Network.POLYGON]: {
      routerAddress: '0x55084eE0fEf03f14a305cd24286359A35D735151',
    },
    [Network.BSC]: {
      routerAddress: '0x55084eE0fEf03f14a305cd24286359A35D735151',
    },
    [Network.ARBITRUM]: {
      routerAddress: '0x55084eE0fEf03f14a305cd24286359A35D735151',
    },
    [Network.AVALANCHE]: {
      routerAddress: '0x55084eE0fEf03f14a305cd24286359A35D735151',
    },
    [Network.OPTIMISM]: {
      routerAddress: '0xCa310B1B942A30Ff4b40a5E1b69AB4607eC79Bc1',
    },
    [Network.BASE]: {
      routerAddress: '0xCa310B1B942A30Ff4b40a5E1b69AB4607eC79Bc1',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter03', index: 14 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 7 }],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter03', index: 1 }],
    [SwapSide.BUY]: [{ name: 'BscBuyAdapter', index: 3 }],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter02', index: 7 }],
    [SwapSide.BUY]: [{ name: 'PolygonBuyAdapter', index: 5 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter03', index: 5 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter02', index: 1 }],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter02', index: 5 }],
    [SwapSide.BUY]: [{ name: 'OptimismBuyAdapter', index: 4 }],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter02', index: 1 }],
    [SwapSide.BUY]: [{ name: 'AvalancheBuyAdapter', index: 3 }],
  },
};
