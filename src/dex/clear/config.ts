import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const ClearConfig: DexConfigMap<DexParams> = {
  clear: {
    [Network.MAINNET]: {
      factoryAddress: '0x8bF266ED803e474AE7Bf09ADB5ba2566c489223d',
      swapAddress: '0xeb5AD3D93E59eFcbC6934caD2B48EB33BAf29745',
      oracleAddress: '0x049ad7Ff0c6BdbaB86baf4b1A5a5cA975e234FCA',
      accessManagerAddress: '0x20a22791923E69f0f27166B59A12aF01cA4E4AF8',
      subgraphURL: 'https://api-eth-mainnet-clear.trevee.xyz/graphql',
      poolGasCost: 150_000,
      feeCode: 0,
    },
  },
};
