import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

export const MeshswapConfig: DexConfigMap<DexParams> = {
  Meshswap: {
    [Network.POLYGON]: {
      //      subgraphURL:
      //        'https://api.thegraph.com/subgraphs/name/meshswap/meshswap',
      factoryAddress: '0x9F3044f7F9FC8bC9eD615d54845b4577B833282d',
      feeCode: 10,
    },
  },
};

export const Adapters: {
  [chainId: number]: {
    [side: string]: { name: string; index: number }[] | null;
  };
} = {
  [Network.POLYGON]: {
    [SwapSide.SELL]: [
      {
        name: 'PolygonAdapter02',
        index: 2,
      },
    ],
    /*
    [SwapSide.BUY]: [
      {
        name: 'PolygonBuyAdapter',
        index: 1,
      },
    ],
    */
  },
};
