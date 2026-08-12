import { HookConfig } from '../types';
import { HookParams } from './types';
import { Network } from '../../../../constants';

// GlueHook is deployed via CREATE from a nonce-0 deployer, so it lives at the SAME
// address on every chain (also live on Blast, Celo, Monad, X Layer, World Chain, Zora,
// Soneium, MegaETH, Robinhood and Tempo beyond the networks configured here).
const GLUEHOOK_ADDRESS = '0xb216070c3509047ea597e2e626a29cea427a60c8';

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
