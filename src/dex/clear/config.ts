import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ClearConfig: DexConfigMap<DexParams> = {
  clear: {
    [Network.MAINNET]: {
      factoryAddress: '0xcEAc924839ba0ef49613d8FF10609434939bEb5b',
      swapAddress: '0xC12247E25bf2ec1a1d43eFa7b5f9e6b579B32F40',
      oracleAddress: '0xA84933DEE05514258E4C2b54468389539567634F',
      accessManagerAddress: '0x42d3E0D351cD3E8aE25b1632611d4411E8d801D9',
      subgraphURL: 'https://api-eth-mainnet-clear.trevee.xyz/graphql',
      poolGasCost: 150_000,
      feeCode: 0,
    },
  },
};
