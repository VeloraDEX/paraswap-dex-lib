import { DexParams } from './types';
import { AdapterMappings, DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

export const ParaSwapLimitOrdersConfig: DexConfigMap<DexParams> = {
  ParaSwapLimitOrders: {
    [Network.AVALANCHE]: {
      rfqAddress: '0x34302c4267d0dA0A8c65510282Cc22E9e39df51f',
    },
    [Network.BSC]: {
      rfqAddress: '0x8DcDfe88EF0351f27437284D0710cD65b20288bb',
    },
    [Network.MAINNET]: {
      rfqAddress: '0xe92b586627ccA7a83dC919cc7127196d70f55a06',
    },
    [Network.POLYGON]: {
      rfqAddress: '0xF3CD476C3C4D3Ac5cA2724767f269070CA09A043',
    },
    [Network.ARBITRUM]: {
      rfqAddress: '0x0927FD43a7a87E3E8b81Df2c44B03C4756849F6D',
    },
    [Network.OPTIMISM]: {
      rfqAddress: '0x0927FD43a7a87E3E8b81Df2c44B03C4756849F6D',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter01', index: 13 }],
    [SwapSide.BUY]: [{ name: 'AvalancheBuyAdapter', index: 2 }],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter01', index: 14 }],
    [SwapSide.BUY]: [{ name: 'BscBuyAdapter', index: 2 }],
  },
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter03', index: 10 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 6 }],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter02', index: 2 }],
    [SwapSide.BUY]: [{ name: 'PolygonBuyAdapter', index: 3 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter01', index: 13 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter', index: 3 }],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter01', index: 7 }],
    [SwapSide.BUY]: [{ name: 'OptimismBuyAdapter', index: 3 }],
  },
};
