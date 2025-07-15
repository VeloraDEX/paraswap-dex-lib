/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('Infusion E2E', () => {
  describe('Base', () => {
    const network = Network.BASE;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    describe('Infusion', () => {
      const dexKey = 'Infusion';

      describe('swapExactAmountIn', () => {
        it('ETH -> USDC', async () => {
          await testE2E(
            tokens.ETH,
            tokens.USDC,
            holders.ETH,
            '3000000000000000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('USDC -> ETH', async () => {
          await testE2E(
            tokens.USDC,
            tokens.ETH,
            holders.USDC,
            '9900000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('WETH -> USDC', async () => {
          await testE2E(
            tokens.WETH,
            tokens.USDC,
            holders.WETH,
            '3000000000000000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('USDC -> WETH', async () => {
          await testE2E(
            tokens.USDC,
            tokens.WETH,
            holders.USDC,
            '3000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('USDbC -> USDC', async () => {
          await testE2E(
            tokens.USDbC,
            tokens.USDC,
            holders.USDbC,
            '9900000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('USDC -> USDbC', async () => {
          await testE2E(
            tokens.USDC,
            tokens.USDbC,
            holders.USDC,
            '9900000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
      });
    });
  });
});
