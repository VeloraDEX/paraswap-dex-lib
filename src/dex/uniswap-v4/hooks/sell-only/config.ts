import { Address } from '@paraswap/core';
import { HookConfig } from '../types';
import { Network } from '../../../../constants';

export type SellOnlyParams = {
  hookAddress: Address;
  // anyone may sell currency0 into the pool; false means currency1.
  sellsCurrency0: boolean;
};

export const SellOnlyHookConfig: HookConfig<SellOnlyParams> = {
  [Network.MAINNET]: {
    hookAddress: '0x56c6038207e87424d3a1dab544526f75761428a0',
    sellsCurrency0: true,
  },
};

export const SellOnlyOneHookConfig: HookConfig<SellOnlyParams> = {
  [Network.MAINNET]: {
    hookAddress: '0xf833a6f720fc355b39c4d8d2e5a61e01d4e928a0',
    sellsCurrency0: false,
  },
};
