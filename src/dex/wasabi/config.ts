import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const WasabiConfig: DexConfigMap<DexParams> = {
  Wasabi: {
    [Network.BASE]: {
      factoryAddress: '0x851fc799c9f1443a2c1e6b966605a80f8a1b1bf2',
      routerAddress: '0xfc81dfde25083a286723b7c9dd7213f8723369fe',
      buffer: 9900,
    },
  },
};

export const SAMPLE_SIZE = 15;
export const DEFAULT_GAS_COST = 200_000;
// Refresh samples every 30 seconds
export const SAMPLE_REFRESH_INTERVAL_MS = 30 * 1000;
// Refresh pool list every 10 minutes
export const POOL_LIST_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
export const BASIS_POINTS = 10_000n;
