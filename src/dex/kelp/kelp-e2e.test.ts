/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('Kelp', () => {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const dexKey = 'Kelp';

  const contractMethod = ContractMethod.swapExactAmountIn;
  const srcTokens = ['ETH', 'WETH', 'STETH', 'wstETH', 'ETHx'];
  const destToken = 'rsETH';
  const testAmount = '1000000000000000000';

  srcTokens.forEach(srcToken => {
    it(`${contractMethod} - ${srcToken} -> ${destToken}`, async () => {
      await testE2E(
        tokens[srcToken],
        tokens[destToken],
        holders[srcToken],
        testAmount,
        SwapSide.SELL,
        dexKey,
        contractMethod,
        network,
        provider,
      );
    });
  });
});
