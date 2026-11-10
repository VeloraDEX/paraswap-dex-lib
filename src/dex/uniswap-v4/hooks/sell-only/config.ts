import { Address } from '@paraswap/core';
import { HookConfig } from '../types';
import { Network } from '../../../../constants';

export const SellOnlyHookConfig: HookConfig<{ hookAddress: Address }> = {
  [Network.MAINNET]: {
    hookAddress: '0x56c6038207e87424d3a1dab544526f75761428a0',
  },
};
