/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { Holders, Tokens } from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';

describe('LunarBase E2E', () => {
  const dexKey = 'LunarBase';
  const network = Network.BASE;

  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  const tokens = Tokens[network];
  const holders = Holders[network];

  const tokenAAmount = '100000000000000'; // 0.0001 ETH
  const tokenBAmount = '1000000'; // 1 USDC

  const slippage = 500;

  describe('Base', () => {
    describe('SELL', () => {
      describe('swapExactAmountIn', () => {
        it('ETH -> USDC', async () => {
          await testE2E(
            tokens['ETH'],
            tokens['USDC'],
            holders['ETH'],
            tokenAAmount,
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
            null,
            undefined,
            undefined,
            slippage,
          );
        });

        it('USDC -> ETH', async () => {
          await testE2E(
            tokens['USDC'],
            tokens['ETH'],
            holders['USDC'],
            tokenBAmount,
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
            null,
            undefined,
            undefined,
            slippage,
          );
        });
      });
    });
  });
});
