import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const InfusionConfig: DexConfigMap<DexParams> = {
  Infusion: {
    [Network.BASE]: {
      subgraphURL:
        'https://api.goldsky.com/api/public/project_clvn0ei0x2qro0130fpihh83o/subgraphs/infusion-subgraph/1.0.0/gn',
      factoryAddress: '0x2D9A3a2bd6400eE28d770c7254cA840c82faf23f',
      router: '0x1E891C9F96DcA29Da8B97bE3403D16135EBe8028',
      initCode:
        '0x219feae2806b91b43e3369a02074b26dde4d33b44972f02d717f37ac78ab0245',
      // updatable fees on the factory without event
      stableFee: 5,
      volatileFee: 5,
      poolGasCost: 180 * 1000,
      feeCode: 5,
    },
  },
};
