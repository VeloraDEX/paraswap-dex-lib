import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('Yieldnest', () => {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const dexKey = 'Yieldnest';

  [ContractMethod.swapExactAmountIn].forEach(contractMethod => {
    it(`${contractMethod} - ETH -> ynETH`, async () => {
      await testE2E(
        tokens.ETH,
        tokens.ynETH,
        holders.ETH,
        '1000000000000000000',
        SwapSide.SELL,
        dexKey,
        contractMethod,
        network,
        provider,
      );
    });

    it(`${contractMethod} - WETH -> ynETH`, async () => {
      await testE2E(
        tokens.WETH,
        tokens.ynETH,
        holders.WETH,
        '1000000000000000000',
        SwapSide.SELL,
        dexKey,
        contractMethod,
        network,
        provider,
      );
    });
  });
});
