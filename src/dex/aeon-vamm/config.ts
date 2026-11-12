import { DexParams } from '../uniswap-v2/types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

export const AeonVAMMConfig: DexConfigMap<DexParams> = {
  AeonVAMM: {
    [Network.AVALANCHE]: {
      factoryAddress: '0x3ECf287990A2365d48C6681620393aC1cdF3D268',
      initCode:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      feeCode: 10,  // 0.1% default; actual per-pool fee is read on-chain
      poolGasCost: 80_000,
    },
  },
};

export const Adapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter01', index: 2 }],
    [SwapSide.BUY]: [{ name: 'AvalancheBuyAdapter', index: 1 }],
  },
};
