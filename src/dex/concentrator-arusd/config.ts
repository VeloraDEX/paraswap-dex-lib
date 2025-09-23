import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ConcentratorArusdConfig: DexConfigMap<DexParams> = {
  ConcentratorArusd: {
    [Network.MAINNET]: {
      rUSDAddress: '0x65D72AA8DA931F047169112fcf34f52DbaAE7D18',
      arUSDAddress: '0x07D1718fF05a8C53C8F05aDAEd57C0d672945f9a',
      arUSD5115Address: '0x549716F858aefF9CB845d4C78c67A7599B0Df240',
    },
  },
};
