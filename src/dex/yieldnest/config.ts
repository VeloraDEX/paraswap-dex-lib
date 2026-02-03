import { Network, SwapSide } from '../../constants';
import { DexConfigMap } from '../../types';
import { Yieldnest } from './yieldnest';

type DexParams = {
  ynETH: `0x${string}`;
};

export const YieldnestConfig: DexConfigMap<DexParams> = {
  Yieldnest: {
    [Network.MAINNET]: {
      ynETH: '0x14dc3d915107dca9ed39e29e14fbdfe4358a1346',
    },
  },
};

export const Adapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [
      {
        name: '',
        index: 0,
      },
    ],
  },
};
