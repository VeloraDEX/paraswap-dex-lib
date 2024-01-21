import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';
const DACKIE_SUPPORTED_FEES = [10000n, 2500n, 500n, 100n];
export const DackieswapV3Config: DexConfigMap<DexParams> = {
  DackieswapV3: {
    [Network.BASE]: {
      factory: '0x3D237AC6D2f425D2E890Cc99198818cc1FA48870',
      deployer: '0x4f205D69834f9B101b9289F7AFFAc9B77B3fF9b7',
      quoter: '0xAc4893796e6786CC224CaDA4a475Eb49aCFdb3f1',
      router: '0x6F887c0Bee01FAfacA39E46cA14cc1D48e28090F',
      supportedFees: DACKIE_SUPPORTED_FEES,
      stateMulticall: '0xeBF40A40CA3D4310Bf53048F48e860656e1D7C81',
      uniswapMulticall: '0x091e99cb1C49331a94dD62755D168E941AbD0693',
      chunksCount: 10,
      initRetryFrequency: 30,
      initHash:
        '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2',
      subgraphURL:
        'https://api.studio.thegraph.com/query/50473/exchange-clmm/version/latest',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 1 }],
    [SwapSide.BUY]: [{ name: 'BaseBuyAdapter', index: 1 }],
  },
};
