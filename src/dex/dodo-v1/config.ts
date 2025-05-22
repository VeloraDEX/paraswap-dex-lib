import { Address } from '@paraswap/core';
import { Network } from '../../constants';

// We use dodo-v2 proxy as the new proxy supports both v1 and v2
export const DODOV2ProxyAddress: { [network: number]: Address } = {
  [Network.MAINNET]: '0xa356867fdcea8e71aeaf87805808803806231fdc',
  [Network.BSC]: '0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486',
  [Network.ARBITRUM]: '0x88CBf433471A0CD8240D2a12354362988b4593E5',
  [Network.POLYGON]: '0xa222e6a71D1A1Dd5F279805fbe38d5329C1d0e70',
  [Network.BASE]: '0x4CAD0052524648A7Fa2cfE279997b00239295F33',
  [Network.AVALANCHE]: '0x2cD18557E14aF72DAA8090BcAA95b231ffC9ea26',
};

export const DODOAproveAddress: { [network: number]: Address } = {
  [Network.MAINNET]: '0xCB859eA579b28e02B87A1FDE08d087ab9dbE5149',
  [Network.BSC]: '0xa128Ba44B2738A558A1fdC06d6303d52D3Cef8c1',
  [Network.ARBITRUM]: '0xA867241cDC8d3b0C07C85cC06F25a0cD3b5474d8',
  [Network.POLYGON]: '0x6D310348d5c12009854DFCf72e0DF9027e8cb4f4',
  [Network.BASE]: '0x89872650fA1A391f58B4E144222bB02e44db7e3B',
  [Network.AVALANCHE]: '0xCFea63e3DE31De53D68780Dd65675F169439e470',
};
