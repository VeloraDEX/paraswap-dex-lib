import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// ranges-stats API base URL for getTopPoolsForToken USD ranking (Stage 6).
export const RANGES_STATS_API_BASE = 'https://rangesevm-api.puzzleswap.org';

// Range Pools run on a CUSTOM, non-canonical Balancer V3 Vault — these are NOT
// the canonical Balancer V3 addresses. Verified against
// ranges-stats/deployments/1/{range,balancer-core}.json.
export const RangePoolConfig: DexConfigMap<DexParams> = {
  RangePool: {
    [Network.MAINNET]: {
      vaultAddress: '0x955244EDC797A1C1b04134b600f819aC23C76081',
      routerAddress: '0x8726019313CD59D2e33dBE643aaC94A59D5518df',
      factoryAddress: '0x5D6D1dC0D045a8DE284C7Ab5FE83aCd7bdc5d4E0',
      hookAddress: '0xf31e1f37E1f9C2C531e6bC3ad89fFc9206cE85d9',
      permit2Address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      apiBaseUrl: RANGES_STATS_API_BASE,
    },
  },
};
