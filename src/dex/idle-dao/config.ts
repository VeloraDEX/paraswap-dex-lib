import { DexParams, IdleToken } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const Config: DexConfigMap<DexParams> = {
  IdleDao: {
    [Network.MAINNET]: {
      lendingGasCost: 328 * 1000,
      factoryAddress: '0x3c9916bb9498f637e2fa86c2028e26275dc9a631',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: '', index: 0 }],
    [SwapSide.BUY]: [{ name: '', index: 0 }],
  },
};

export const endpoints: Record<number, string> = {
  [Network.MAINNET]: 'https://api.idle.finance/pools',
  [Network.POLYGON]: 'https://api-polygon.idle.finance/pools',
  [Network.OPTIMISM]: 'https://api-optimism.idle.finance/pools',
};
