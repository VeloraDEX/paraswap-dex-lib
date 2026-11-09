import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Relay deploys at the same address on every chain.
const RELAY = '0xc81fd894c0ace037d133af4886550ac8133568e8';

// Enumerates every bToken and its reserve, filtered by chainId.
const SUBGRAPH_URL = 'https://bl-api.baseline-protocol.workers.dev/graphql';

export const BaselineConfig: DexConfigMap<DexParams> = {
  Baseline: {
    [Network.MAINNET]: {
      relay: RELAY,
      subgraphURL: SUBGRAPH_URL,
      // Priority pools kept available even if discovery is momentarily down.
      bTokens: [
        '0x9fDbDE76236998Dc2836FE67A9954eDE456A1D63', // B / WETH
        '0x80Ea38D56E262457D73c0d8dFe027AE8925821e2', // ONYX / WETH
      ],
    },
    [Network.BASE]: {
      relay: RELAY,
      subgraphURL: SUBGRAPH_URL,
      bTokens: [
        '0xff8104251e7761163fac3211ef5583fb3f8583d6', // REPPO / VIRTUAL
        '0x4082b90beBa6935c7718497165557106e43a6aC6', // BSR / cbBTC (8-dec reserve)
      ],
    },
  },
};
