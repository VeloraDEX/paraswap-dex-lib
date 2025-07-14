import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const KelpConfig: DexConfigMap<DexParams> = {
  Kelp: {
    [Network.MAINNET]: {
      lrtDepositPool: '0x036676389e48133B63a802f8635AD39E752D375D',
      lrtOracle: '0x349A73444b1a310BAe67ef67973022020d70020d',
      weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      ETHx: '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b',
      rsETH: '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7',
    },
  },
};
