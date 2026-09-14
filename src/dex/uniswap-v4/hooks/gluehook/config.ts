import { HookConfig } from '../types';
import { HookParams } from './types';
import { Network } from '../../../../constants';

// GlueHook V3 — deployed via CREATE from a nonce-0 deployer, so it lives at the SAME
// address on every chain (also live on X Layer, World Chain, Soneium, MegaETH and
// Robinhood beyond the networks configured here). Permission bits 0x2040.
const GLUEHOOK_ADDRESS = '0xbb021554c5294328b04fa313669715bd201ba040';

export const GlueHookConfig: HookConfig<HookParams> = {
  [Network.MAINNET]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.BASE]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.OPTIMISM]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.ARBITRUM]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.POLYGON]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.AVALANCHE]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.BSC]: { hookAddress: GLUEHOOK_ADDRESS },
  [Network.UNICHAIN]: { hookAddress: GLUEHOOK_ADDRESS },
};
