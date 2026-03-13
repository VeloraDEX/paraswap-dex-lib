import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('dETH E2E', () => {
  describe('dETH Mainnet', () => {
    const dexKey = 'dETH';
    const network = Network.MAINNET;

    const nativeTokenSymbol = 'ETH';
    const wrappedTokenSymbol = 'dETH';

    const nativeAmount = '100000000000000000';
    const wrappedAmount = '100000000000000000';

    const tokens = Tokens[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const nativeToken = tokens[nativeTokenSymbol];
    const wrappedToken = tokens[wrappedTokenSymbol];

    describe('swapExactAmountIn SELL', () => {
      const contractMethod = ContractMethod.swapExactAmountIn;
      const side = SwapSide.SELL;

      it('native -> wrapped', async () => {
        await testE2E(
          nativeToken,
          wrappedToken,
          '',
          nativeAmount,
          side,
          dexKey,
          contractMethod,
          network,
          provider,
        );
      });
      it('wrapped -> native', async () => {
        await testE2E(
          wrappedToken,
          nativeToken,
          '',
          wrappedAmount,
          side,
          dexKey,
          contractMethod,
          network,
          provider,
        );
      });
    });
  });
});
