import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const MAV_V2_BASE_GAS_COST = 50_000;
export const MAV_V2_TICK_GAS_COST = 10_000;
export const MAVERICK_API_URL = `https://v2-api.mav.xyz/`;

export const MaverickV2Config: DexConfigMap<DexParams> = {
  MaverickV2: {
    [Network.BASE]: {
      routerAddress: `0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527`,
      quoterAddress: `0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A`,
      poolLensAddress: `0x942646b0A8B42Af1e1044439013436a9a3e080b5`,
    },
    [Network.MAINNET]: {
      routerAddress: `0x62e31802c6145A2D5E842EeD8efe01fC224422fA`,
      quoterAddress: `0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A`,
      poolLensAddress: `0x942646b0A8B42Af1e1044439013436a9a3e080b5`,
    },
    [Network.BSC]: {
      routerAddress: `0x374bFCc264678c67a582D067AD91f1951bC6b20f`,
      quoterAddress: `0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A`,
      poolLensAddress: `0x942646b0A8B42Af1e1044439013436a9a3e080b5`,
    },
    [Network.ARBITRUM]: {
      routerAddress: `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76`,
      quoterAddress: `0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A`,
      poolLensAddress: `0x942646b0A8B42Af1e1044439013436a9a3e080b5`,
    },
  },
};
