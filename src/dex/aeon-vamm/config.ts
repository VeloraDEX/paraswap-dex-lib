import { DexConfigMap } from '../../dex-helper/index';
import { Network } from '../../../constants';
import { AeonVAMMData } from './types';

export const AeonVAMMConfig: DexConfigMap<AeonVAMMData> = {
  AeonVAMM: {
    [Network.AVALANCHE]: {
      subgraphURL: '',
      factoryAddress: '0x3ECf287990A2365d48C6681620393aC1cdF3D268',
      initCode:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      feeCode: 30,         // default 0.3%; per-pool fee read from feeBps()
      poolGasCost: 80_000,
    },
  },
};

export const Adapters = {
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter02', index: 5 }],
  },
};

// Lazy import to avoid circular deps
import { SwapSide } from '../../../constants';
