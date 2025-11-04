import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const DexalotConfig: DexConfigMap<DexParams> = {
  Dexalot: {
    [Network.AVALANCHE]: {
      dexalotRouterAddress: '0xaE91a58f28E7770FEc53Ad648f927C6D0260c9fb',
    },
    [Network.ARBITRUM]: {
      dexalotRouterAddress: '0xaE91a58f28E7770FEc53Ad648f927C6D0260c9fb',
    },
    [Network.BASE]: {
      dexalotRouterAddress: '0xaE91a58f28E7770FEc53Ad648f927C6D0260c9fb',
    },
    [Network.BSC]: {
      dexalotRouterAddress: '0xaE91a58f28E7770FEc53Ad648f927C6D0260c9fb',
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
