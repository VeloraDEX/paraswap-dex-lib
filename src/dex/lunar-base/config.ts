import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';
import { LunarBaseDexParams, LUNAR_BASE_DEFAULT_FEE_CONFIG } from './types';

export const LunarBaseAdapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  [Network.BASE]: {
    [SwapSide.SELL]: [
      {
        name: 'BaseAdapter01',
        index: 6,
      },
    ],
    [SwapSide.BUY]: [
      {
        name: 'BaseBuyAdapter',
        index: 4,
      },
    ],
  },
};

export const LunarBaseConfig: DexConfigMap<LunarBaseDexParams> = {
  LunarBase: {
    [Network.BASE]: {
      factoryAddress: '0xC0B5B8D26D29f32b4b609CD273fa05d14E25b60F',
      routerAddress: '0x19CEF85D1248006E2Dfb5A30Ad7E5Db39155F9fE',
      quoterAddress: '0x421f5A5ec2dAA42EfE4142A4DA0e87E9fa4ECC21',
      coreModuleAddress: '0x1980D075Dc98Ae2fFc0e15BE56A850931856C66b',
      apiURL: 'https://api.lunarbase.gg/api/amm/pools',
      poolGasCost: 100 * 1000,
      defaultBaseFee: LUNAR_BASE_DEFAULT_FEE_CONFIG.baseFee,
    },
  },
};
