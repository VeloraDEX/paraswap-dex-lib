import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { DummyDexHelper } from '../../dex-helper';
import { WethConfig } from './config';

const NETWORKS = [
  Network.MAINNET,
  Network.AVALANCHE,
  Network.BSC,
  Network.BASE,
  Network.POLYGON,
  Network.OPTIMISM,
  Network.FANTOM,
  Network.ARBITRUM,
  Network.ZKEVM,
  Network.GNOSIS,
  Network.UNICHAIN,
];

const nativeAmount = '10000000000000000';
const wrappedAmount = '10000000000000000';

describe('Wrapped Native E2E v6', () => {
  NETWORKS.forEach(network => {
    describe(`${network}`, () => {
      const dexKey = Object.keys(WethConfig).find(
        key => !!WethConfig[key][network],
      );
      if (!dexKey) return;

      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const dexHelper = new DummyDexHelper(network);

      const nativeTokenSymbol =
        dexHelper.config.data.nativeTokenSymbol.toUpperCase();
      const wrappedTokenSymbol =
        dexHelper.config.data.wrappedNativeTokenSymbol.toUpperCase();

      const nativeToken = tokens[nativeTokenSymbol];
      const wrappedToken = tokens[wrappedTokenSymbol];

      const nativeHolder = holders[nativeTokenSymbol];
      const wrappedHolder = holders[wrappedTokenSymbol];

      [
        ContractMethod.simpleSwap,
        ContractMethod.multiSwap,
        ContractMethod.megaSwap,
      ].forEach(contractMethod => {
        describe(`${contractMethod}`, () => {
          it(`SELL ${nativeTokenSymbol} -> ${wrappedTokenSymbol}`, async () => {
            await testE2E(
              nativeToken,
              wrappedToken,
              nativeHolder,
              nativeAmount,
              SwapSide.SELL,
              dexKey,
              contractMethod,
              network,
              provider,
            );
          });
          it(`SELL ${wrappedTokenSymbol} -> ${nativeTokenSymbol}`, async () => {
            await testE2E(
              wrappedToken,
              nativeToken,
              wrappedHolder,
              wrappedAmount,
              SwapSide.SELL,
              dexKey,
              contractMethod,
              network,
              provider,
            );
          });
          // it(`BUY ${nativeTokenSymbol} -> ${wrappedTokenSymbol}`, async () => {
          //   await testE2E(
          //     nativeToken,
          //     wrappedToken,
          //     nativeHolder,
          //     nativeAmount,
          //     SwapSide.BUY,
          //     dexKey,
          //     contractMethod,
          //     network,
          //     provider,
          //   );
          // });
          // it(`BUY ${wrappedTokenSymbol} -> ${nativeTokenSymbol}`, async () => {
          //   await testE2E(
          //     wrappedToken,
          //     nativeToken,
          //     wrappedHolder,
          //     wrappedAmount,
          //     SwapSide.BUY,
          //     dexKey,
          //     contractMethod,
          //     network,
          //     provider,
          //   );
          // });
        });
      });
    });
  });
});
