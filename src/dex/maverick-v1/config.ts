import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const MAV_V1_BASE_GAS_COST = 5_574 + 2_258 + 4_472 + 90_000;
export const MAV_V1_TICK_GAS_COST = 25_000;
export const MAV_V1_KIND_GAS_COST = 15_000;

export const MaverickV1Config: DexConfigMap<DexParams> = {
  MaverickV1: {
    [Network.MAINNET]: {
      subgraphURL: 'H4KMc3uRaRqKrM8dq8GKCt9gwmMQsRRiQRThZCM16KtB',
      routerAddress: '0x4a585e0f7c18e2c414221d6402652d5e0990e5f8',
      poolInspectorAddress: '0xaA5BF61a664109e959D69C38734d4EA7dF74e456',
    },
    [Network.BASE]: {
      subgraphURL: 'CSxkHjxpG1TxTBQMn55uG1DWpdD4Lsix4RNX4RTLvK4T',
      routerAddress: '0x32AED3Bce901DA12ca8489788F3A99fCe1056e14',
      poolInspectorAddress: '0x65A3AD03Be97619284bA7AA1E3Ca05638B9d6364',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter04', index: 2 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 8 }],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 2 }],
    [SwapSide.BUY]: [{ name: 'BaseBuyAdapter', index: 2 }],
  },
};
