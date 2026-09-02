import { HookConfig } from '../types';
import { HookParams } from './types';
import { Network } from '../../../../constants';

// Deployed via CreateX, same address on every supported network
const ARRAKIS_PRIVATE_HOOK_ADDRESS =
  '0xa4e6f5500e88691fdcb289aa0e99067481434880';

export const ArrakisPrivateHookConfig: HookConfig<HookParams> = {
  [Network.MAINNET]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
  },
  [Network.OPTIMISM]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
  },
  [Network.BSC]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
  },
  [Network.BASE]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
  },
  [Network.ARBITRUM]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
  },
};
