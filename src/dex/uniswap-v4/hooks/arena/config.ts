import { HookConfig } from '../types';
import { HookParams } from './types';
import { Network } from '../../../../constants';

export const ArenaHookConfig: HookConfig<HookParams> = {
  [Network.AVALANCHE]: {
    hookAddress: '0xe32a5d788c568fc5a671255d17b618e70552e044',
    feeHelperAddress: '0x537505da49b4249b576fc8d00028bfddf6189077',
  },
};
