import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const AlgebraIntegralConfig: DexConfigMap<DexParams> = {
  QuickSwapV4: {
    [Network.BASE]: {
      factory: '0xC5396866754799B9720125B104AE01d935Ab9C7b',
      subgraphURL: 'U65NKb6BsDPGqugPAda58ebMLa1RqeMFT76fndB77oe',
      quoter: '0xA8a1dA1279ea63535c7B3BE8D20241483BC61009',
      router: '0xe6c9bb24ddB4aE5c6632dbE0DE14e3E474c6Cb04',
      chunksCount: 10,
      stateMulticall: '0x0062C27357c71792c6767fA799f974B30BfB8630',
    },
  },
  BlackholeCL: {
    [Network.AVALANCHE]: {
      factory: '0x512eb749541B7cf294be882D636218c84a5e9E5F',
      subgraphURL:
        'https://api.goldsky.com/api/public/project_cm8gyxv0x02qv01uphvy69ey6/subgraphs/poap-subgraph-core/avax-main/gn',
      quoter: '0x3e182bcf14Be6142b9217847ec1112e3c39Eb689',
      router: '0xaBfc48e8BED7b26762745f3139555F320119709d',
      chunksCount: 10,
      stateMulticall: '0x484e14Ec742943Ed303310822Fe2FB993B075741',
    },
  },
  Supernova: {
    [Network.MAINNET]: {
      factory: '0x44B7fBd4D87149eFa5347c451E74B9FD18E89c55',
      subgraphURL:
        'https://api.goldsky.com/api/public/project_cm8gyxv0x02qv01uphvy69ey6/subgraphs/core/algebrasnmainnet/gn',
      quoter: '0x8217550d36823b1194b58562dac55d7fe8efb727',
      router: '0x72d63a5b080e1b89cc93f9b9f50cbfa5e291c8ac',
      chunksCount: 10,
      stateMulticall: '0xFC18433f203c58b8104eCb9b2e995032bc29f64f',
    },
  },
  NamiV4: {
    [Network.MAINNET]: {
      factory: '0xD1Bf4A24DC17Da21410a7b047471E191eA538d43',
      subgraphURL: 'https://subgraph.nami.fi/ethereum',
      quoter: '0x8c9f3B1f8a82253A58C5013483cEB91728c3A909',
      router: '0xD50c67eA041eDeDBEF203F8A92B0E71dA2d72245',
      chunksCount: 10,
      stateMulticall: '0xFC18433f203c58b8104eCb9b2e995032bc29f64f',
    },
    [Network.BASE]: {
      factory: '0xf4502A98A15e82D66d28D2381E2F3A407ea45b83',
      subgraphURL: 'https://subgraph.nami.fi/base',
      quoter: '0x5Ed0C723cd5680F0f6a4c8f334876E9cD92F3Bcb',
      router: '0xDB5F3B86f2CE75a8b2aD0120C01193CaDA30F4c8',
      chunksCount: 10,
      stateMulticall: '0x0062C27357c71792c6767fA799f974B30BfB8630',
    },
    [Network.ROBINHOOD]: {
      factory: '0xDeDB80903df19f9dB9b393eb66E07511CB9ABdA2',
      subgraphURL: 'https://subgraph.nami.fi/robinhood',
      quoter: '0xb6167Dea933239D42553EE0fba1dF59Da096706d',
      router: '0x77CCb6e518e86C0d6cebE8C34Cb392267213E6bA',
      chunksCount: 10,
      stateMulticall: '0xfdd8e6d7324d976056a2eaf6ebf717bff431a3e2',
    },
  },
};
