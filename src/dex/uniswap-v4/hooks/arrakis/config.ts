import { HookConfig } from '../types';
import { HookParams } from './types';
import { Network } from '../../../../constants';

// Deployed via CreateX, same addresses on every supported network
const ARRAKIS_PRIVATE_HOOK_ADDRESS =
  '0xa4e6f5500e88691fdcb289aa0e99067481434880';
const ARRAKIS_META_VAULT_FACTORY_ADDRESS =
  '0x820fb8127a689327c863de8433278d6181123982';

export const ArrakisPrivateHookConfig: HookConfig<HookParams> = {
  [Network.MAINNET]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
    factoryAddress: ARRAKIS_META_VAULT_FACTORY_ADDRESS,
  },
  [Network.OPTIMISM]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
    factoryAddress: ARRAKIS_META_VAULT_FACTORY_ADDRESS,
  },
  [Network.BSC]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
    factoryAddress: ARRAKIS_META_VAULT_FACTORY_ADDRESS,
  },
  [Network.BASE]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
    factoryAddress: ARRAKIS_META_VAULT_FACTORY_ADDRESS,
  },
  [Network.ARBITRUM]: {
    hookAddress: ARRAKIS_PRIVATE_HOOK_ADDRESS,
    factoryAddress: ARRAKIS_META_VAULT_FACTORY_ADDRESS,
  },
};
