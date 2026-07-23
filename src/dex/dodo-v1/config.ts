import { Address } from '@paraswap/core';
import { Network } from '../../constants';

// We use dodo-v2 proxy as the new proxy supports both v1 and v2
export const DODOV2ProxyAddress: { [network: number]: Address } = {
  [Network.BSC]: '0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486',
};

export const DODOApproveAddress: { [network: number]: Address } = {
  [Network.BSC]: '0xa128Ba44B2738A558A1fdC06d6303d52D3Cef8c1',
};
